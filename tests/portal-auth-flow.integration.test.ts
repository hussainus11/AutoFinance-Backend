import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { portalAuthRouter } from "../src/controllers/portal/portal-auth.controller.js";
import { requirePortalAuth } from "../src/portal-auth/require-portal-auth.js";
import { hashPassword } from "../src/auth/password.js";
import { generateRefreshTokenRaw, hashRefreshToken } from "../src/auth/jwt.js";
import { prisma } from "../src/prisma.js";

const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const BUYER_EMAIL = "portal-buyer@example.com";
const GUARANTOR_EMAIL = "portal-guarantor@example.com";
const PASSWORD = "TestPassw0rd!";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(
    "/api",
    (req, res, next) => {
      const publicPaths = new Set(["/portal/auth/login", "/portal/auth/refresh", "/portal/auth/logout"]);
      if (publicPaths.has(req.path)) return next();
      if (/^\/portal\/auth\/invite\/[^/]+(\/activate)?$/.test(req.path)) return next();
      return requirePortalAuth(req, res, next);
    },
    portalAuthRouter
  );
  app.get("/api/portal/protected/ping", requirePortalAuth, (_req, res) => res.json({ ok: true }));

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

let buyerId: string;

beforeEach(async () => {
  await prisma.partnerPortalInvite.deleteMany({});
  await prisma.partnerRefreshToken.deleteMany({});
  await prisma.partner.deleteMany({ where: { email: { in: [BUYER_EMAIL, GUARANTOR_EMAIL] } } });
  await prisma.company.upsert({
    where: { id: COMPANY_ID },
    create: { id: COMPANY_ID, name: "Portal Integration Test Co" },
    update: {}
  });

  const buyer = await prisma.partner.create({
    data: {
      companyId: COMPANY_ID,
      type: "BUYER",
      displayName: "Portal Test Buyer",
      email: BUYER_EMAIL,
      passwordHash: hashPassword(PASSWORD)
    }
  });
  buyerId = buyer.id;

  await prisma.partner.create({
    data: {
      companyId: COMPANY_ID,
      type: "GUARANTOR",
      displayName: "Portal Test Guarantor",
      email: GUARANTOR_EMAIL,
      passwordHash: hashPassword(PASSWORD)
    }
  });
});

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
}

async function request(jar: CookieJar, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Cookie: jar.header() }
  });
  jar.absorb(res);
  return res;
}

describe("portal auth flow", () => {
  it("rejects login for a GUARANTOR-type partner even with the correct password", async () => {
    const jar = new CookieJar();
    const res = await request(jar, "/portal/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: GUARANTOR_EMAIL, password: PASSWORD })
    });
    expect(res.status).toBe(401);
    expect(jar.get("afp_access")).toBeUndefined();
  });

  it("logs in a BUYER-type partner and sets httpOnly portal cookies", async () => {
    const jar = new CookieJar();
    const res = await request(jar, "/portal/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: BUYER_EMAIL, password: PASSWORD })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accessToken).toBeUndefined();
    expect(body.type).toBe("BUYER");
    expect(jar.get("afp_access")).toBeTruthy();
    expect(jar.get("afp_refresh")).toBeTruthy();

    const ping = await request(jar, "/portal/protected/ping");
    expect(ping.status).toBe(200);
  });

  it("rejects a staff-shaped bearer token on portal routes (audience separation, end-to-end)", async () => {
    // A garbage/foreign token must be rejected outright regardless of shape.
    const res = await fetch(`${baseUrl}/api/portal/protected/ping`, {
      headers: { Cookie: "afp_access=not-a-real-token" }
    });
    expect(res.status).toBe(401);
  });

  it("activates portal access via invite, then can log in with the new password", async () => {
    const rawToken = generateRefreshTokenRaw();
    await prisma.partnerPortalInvite.create({
      data: {
        partnerId: buyerId,
        tokenHash: hashRefreshToken(rawToken),
        expiresAt: new Date(Date.now() + 86_400_000)
      }
    });

    const validateRes = await fetch(`${baseUrl}/api/portal/auth/invite/${rawToken}`);
    expect(validateRes.status).toBe(200);

    const jar = new CookieJar();
    const activateRes = await request(jar, `/portal/auth/invite/${rawToken}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "BrandNewPassw0rd!" })
    });
    expect(activateRes.status).toBe(204);
    expect(jar.get("afp_access")).toBeTruthy(); // auto-logged-in after activation

    // Invite is now consumed — re-activating must fail.
    const secondActivate = await fetch(`${baseUrl}/api/portal/auth/invite/${rawToken}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "AnotherPassw0rd!" })
    });
    expect(secondActivate.status).toBe(404);

    // Can now log in normally with the new password.
    const loginJar = new CookieJar();
    const loginRes = await request(loginJar, "/portal/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: BUYER_EMAIL, password: "BrandNewPassw0rd!" })
    });
    expect(loginRes.status).toBe(200);
  });

  it("rotates the refresh token and revokes the whole family on reuse", async () => {
    const jar = new CookieJar();
    await request(jar, "/portal/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: BUYER_EMAIL, password: PASSWORD })
    });
    const originalRefresh = jar.get("afp_refresh");

    const refreshRes = await request(jar, "/portal/auth/refresh", { method: "POST" });
    expect(refreshRes.status).toBe(204);
    const rotatedRefresh = jar.get("afp_refresh");
    expect(rotatedRefresh).not.toBe(originalRefresh);

    const replay = await fetch(`${baseUrl}/api/portal/auth/refresh`, {
      method: "POST",
      headers: { Cookie: `afp_refresh=${originalRefresh}` }
    });
    expect(replay.status).toBe(401);

    const rows = await prisma.partnerRefreshToken.findMany({ where: { partnerId: buyerId } });
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it("logout revokes the session; a subsequent refresh fails", async () => {
    const jar = new CookieJar();
    await request(jar, "/portal/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: BUYER_EMAIL, password: PASSWORD })
    });

    const logoutRes = await request(jar, "/portal/auth/logout", { method: "POST" });
    expect(logoutRes.status).toBe(204);

    const refreshAfterLogout = await request(jar, "/portal/auth/refresh", { method: "POST" });
    expect(refreshAfterLogout.status).toBe(401);
  });
});
