import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { verifyPassword } from "../auth/password.js";
import { issueSession, rotateSession, revokeSession } from "../auth/session.js";
import { setAuthCookies, clearAuthCookies, readRefreshToken } from "../auth/cookies.js";
import { getRequestContext } from "../context.js";
import { authLimiter } from "../rate-limit.js";

export const authRouter = Router();

const loginBody = z
  .object({
    email: z.string().email(),
    password: z.string().min(1)
  })
  .strict();

authRouter.post("/auth/login", authLimiter, async (req, res, next) => {
  try {
    const body = loginBody.parse(req.body);
    const email = body.email.toLowerCase();

    const user = await (prisma as any).user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        avatarUrl: true,
        role: true,
        companyId: true,
        branchId: true,
        passwordHash: true
      }
    });

    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    if (!user.companyId) {
      res.status(400).json({ error: "This user is not linked to a company. Please contact support." });
      return;
    }

    const company = await (prisma as any).company.findUnique({
      where: { id: user.companyId },
      select: { slug: true, name: true, isActive: true }
    });
    if (company && company.isActive === false) {
      res.status(403).json({ error: "This company's access has been suspended. Please contact support." });
      return;
    }

    const session = await issueSession(user.id);
    setAuthCookies(res, session.accessToken, session.refreshTokenRaw, session.refreshExpiresAt);

    res.json(
      serialize({
        userId: user.id,
        email: user.email,
        name: user.name ?? null,
        phone: user.phone ?? null,
        avatarUrl: user.avatarUrl ?? null,
        role: user.role,
        companyId: user.companyId,
        branchId: user.branchId ?? null,
        companySlug: company?.slug ?? null
      })
    );
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    next(e);
  }
});

authRouter.post("/auth/refresh", authLimiter, async (req, res, next) => {
  try {
    const refreshTokenRaw = readRefreshToken(req);
    if (!refreshTokenRaw) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const result = await rotateSession(refreshTokenRaw);
    if (result.ok === false) {
      clearAuthCookies(res);
      if (result.reason === "reused") {
        console.warn("[auth] refresh token reuse detected — session family revoked");
      }
      if (result.reason === "blocked") {
        res.status(403).json({ error: "This company's access has been suspended. Please contact support." });
        return;
      }
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }

    setAuthCookies(res, result.accessToken, result.refreshTokenRaw, result.refreshExpiresAt);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

authRouter.post("/auth/logout", async (req, res, next) => {
  try {
    const refreshTokenRaw = readRefreshToken(req);
    if (refreshTokenRaw) {
      await revokeSession(refreshTokenRaw);
    }
    clearAuthCookies(res);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

// Note: requireAuth is already applied by apiRouter.ts's global gate for this path
// (it's not in PUBLIC_PATHS), so getRequestContext() below is guaranteed populated.
authRouter.get("/auth/session", async (_req, res, next) => {
  try {
    const ctx = getRequestContext();
    if (!ctx) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const user = await (prisma as any).user.findUnique({
      where: { id: ctx.userId },
      select: { id: true, email: true, name: true, phone: true, avatarUrl: true, role: true, roleId: true, companyId: true, branchId: true }
    });
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const isAdmin = String(user.role).toUpperCase() === "ADMIN";
    let permissionKeys: string[] = [];
    if (!isAdmin && user.roleId) {
      const rolePermissions = await (prisma as any).rolePermission.findMany({
        where: { roleId: user.roleId },
        select: { key: true }
      });
      permissionKeys = rolePermissions.map((p: { key: string }) => p.key);
    }

    const company = user.companyId
      ? await (prisma as any).company.findUnique({
          where: { id: user.companyId },
          select: { slug: true, name: true, isPlatformOwner: true }
        })
      : null;

    res.json(
      serialize({
        userId: user.id,
        email: user.email,
        name: user.name ?? null,
        phone: user.phone ?? null,
        avatarUrl: user.avatarUrl ?? null,
        role: user.role,
        roleId: user.roleId ?? null,
        companyId: user.companyId,
        branchId: user.branchId ?? null,
        isAdmin,
        permissionKeys,
        companySlug: company?.slug ?? null,
        isPlatformOwner: company?.isPlatformOwner ?? false
      })
    );
  } catch (e) {
    next(e);
  }
});
