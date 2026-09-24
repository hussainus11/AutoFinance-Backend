import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { authRouter } from "../src/controllers/auth.controller.js";
import { requireAuth } from "../src/auth/require-auth.js";
import { hashPassword } from "../src/auth/password.js";
import { prisma } from "../src/prisma.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const USER_EMAIL = "integration-test@example.com";
const USER_PASSWORD = "TestPassw0rd!";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(
    "/api",
    (req, res, next) => {
      if (req.path === "/auth/login" || req.path === "/auth/refresh" || req.path === "/auth/logout") return next();
      return requireAuth(req, res, next);
    },
    authRouter
  );
  app.get("/api/protected/ping", requireAuth, (_req, res) => res.json({ ok: true }));

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.refreshToken.deleteMany({});
  await prisma.user.deleteMany({ where: { email: USER_EMAIL } });
  await prisma.company.upsert({
    where: { id: COMPANY_ID },
    create: { id: COMPANY_ID, name: "Integration Test Co" },
    update: {}
  });
  await prisma.user.create({
    data: {
      email: USER_EMAIL,
      name: "Integration Test User",
      role: "USER",
      companyId: COMPANY_ID,
      passwordHash: hashPassword(USER_PASSWORD)
    }
  });
});

/** Minimal manual cookie jar — good enough to drive the real server logic under test;
 *  doesn't model Path scoping the way a browser would (the server doesn't care either). */
class CookieJar {
  private jar = new Map<string, string>();

  absorb(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const idx = pair.indexOf("=");
      if (idx === -1) continue;
      this.jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  get(name: string): string | undefined {
    return this.jar.get(name);
  }

  clear() {
    this.jar.clear();
  }
}

async function request(jar: CookieJar, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Cookie: jar.header() }
  });
  jar.absorb(res);
  return res;
}

describe("auth flow (login -> protected route -> refresh -> reuse detection -> logout)", () => {
  it("rejects bad credentials with 401 and sets no cookies", async () => {
    const jar = new CookieJar();
    const res = await request(jar, "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: USER_EMAIL, password: "wrong-password" })
    });
    expect(res.status).toBe(401);
    expect(jar.get("af_access")).toBeUndefined();
  });

  it("logs in, sets httpOnly session cookies, and grants access to a protected route", async () => {
    const jar = new CookieJar();
    const loginRes = await request(jar, "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD })
    });
    expect(loginRes.status).toBe(200);
    const body = await loginRes.json();
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
    expect(jar.get("af_access")).toBeTruthy();
    expect(jar.get("af_refresh")).toBeTruthy();

    const pingRes = await request(jar, "/protected/ping");
    expect(pingRes.status).toBe(200);
  });

  it("rejects protected routes with no cookie, and with a garbage token", async () => {
    const noAuthJar = new CookieJar();
    const noneRes = await request(noAuthJar, "/protected/ping");
    expect(noneRes.status).toBe(401);

    const garbageJar = new CookieJar();
    const garbageRes = await fetch(`${baseUrl}/api/protected/ping`, {
      headers: { Cookie: "af_access=not-a-real-token" }
    });
    expect(garbageRes.status).toBe(401);
  });

  it("rotates the refresh token, and rejects + revokes the whole family on reuse", async () => {
    const jar = new CookieJar();
    await request(jar, "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD })
    });
    const originalRefresh = jar.get("af_refresh");
    expect(originalRefresh).toBeTruthy();

    const refreshRes = await request(jar, "/auth/refresh", { method: "POST" });
    expect(refreshRes.status).toBe(204);
    const rotatedRefresh = jar.get("af_refresh");
    expect(rotatedRefresh).toBeTruthy();
    expect(rotatedRefresh).not.toBe(originalRefresh);

    // Replaying the original (now-revoked) refresh token must fail...
    const replayRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { Cookie: `af_refresh=${originalRefresh}` }
    });
    expect(replayRes.status).toBe(401);

    // ...and must revoke the ENTIRE rotation family, including the just-rotated token.
    const rows = await prisma.refreshToken.findMany({ where: { user: { email: USER_EMAIL } } });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);

    const retryRotatedRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { Cookie: `af_refresh=${rotatedRefresh}` }
    });
    expect(retryRotatedRes.status).toBe(401);
  });

  it("logout revokes the session; a subsequent refresh with that cookie fails", async () => {
    const jar = new CookieJar();
    await request(jar, "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD })
    });

    const logoutRes = await request(jar, "/auth/logout", { method: "POST" });
    expect(logoutRes.status).toBe(204);

    const refreshAfterLogout = await request(jar, "/auth/refresh", { method: "POST" });
    expect(refreshAfterLogout.status).toBe(401);
  });

  it("GET /auth/session returns the caller's identity when authenticated", async () => {
    const jar = new CookieJar();
    await request(jar, "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD })
    });

    const sessionRes = await request(jar, "/auth/session");
    expect(sessionRes.status).toBe(200);
    const session = await sessionRes.json();
    expect(session.email).toBe(USER_EMAIL);
    expect(session.companyId).toBe(COMPANY_ID);
  });
});
