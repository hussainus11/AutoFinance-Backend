import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { serialize } from "../../serialize.js";
import { verifyPassword, hashPassword } from "../../auth/password.js";
import { hashRefreshToken } from "../../auth/jwt.js";
import {
  issuePortalSession,
  rotatePortalSession,
  revokePortalSession
} from "../../portal-auth/session.js";
import {
  setPortalAuthCookies,
  clearPortalAuthCookies,
  readPortalRefreshToken
} from "../../portal-auth/cookies.js";
import { getPortalContext } from "../../portal-context.js";
import { portalAuthLimiter } from "../../rate-limit.js";

export const portalAuthRouter = Router();

const loginBody = z
  .object({
    email: z.string().email(),
    password: z.string().min(1)
  })
  .strict();

portalAuthRouter.post("/portal/auth/login", portalAuthLimiter, async (req, res, next) => {
  try {
    const body = loginBody.parse(req.body);
    const email = body.email.toLowerCase();

    const partner = await (prisma as any).partner.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: {
        id: true,
        displayName: true,
        email: true,
        type: true,
        companyId: true,
        branchId: true,
        passwordHash: true
      }
    });

    if (!partner || partner.type === "GUARANTOR" || !verifyPassword(body.password, partner.passwordHash)) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    if (!partner.companyId) {
      res.status(400).json({ error: "This account is not linked to a company. Please contact support." });
      return;
    }

    const session = await issuePortalSession(partner.id);
    setPortalAuthCookies(res, session.accessToken, session.refreshTokenRaw, session.refreshExpiresAt);

    res.json(
      serialize({
        partnerId: partner.id,
        email: partner.email,
        name: partner.displayName,
        type: partner.type,
        companyId: partner.companyId,
        branchId: partner.branchId ?? null
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

portalAuthRouter.post("/portal/auth/refresh", portalAuthLimiter, async (req, res, next) => {
  try {
    const refreshTokenRaw = readPortalRefreshToken(req);
    if (!refreshTokenRaw) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const result = await rotatePortalSession(refreshTokenRaw);
    if (result.ok === false) {
      clearPortalAuthCookies(res);
      if (result.reason === "reused") {
        console.warn("[portal-auth] refresh token reuse detected — session family revoked");
      }
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }

    setPortalAuthCookies(res, result.accessToken, result.refreshTokenRaw, result.refreshExpiresAt);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

portalAuthRouter.post("/portal/auth/logout", async (req, res, next) => {
  try {
    const refreshTokenRaw = readPortalRefreshToken(req);
    if (refreshTokenRaw) {
      await revokePortalSession(refreshTokenRaw);
    }
    clearPortalAuthCookies(res);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

// Note: requirePortalAuth is already applied by apiRouter.ts's global gate for this path,
// so getPortalContext() below is guaranteed populated.
portalAuthRouter.get("/portal/auth/session", async (_req, res, next) => {
  try {
    const ctx = getPortalContext();
    if (!ctx) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const partner = await (prisma as any).partner.findUnique({
      where: { id: ctx.partnerId },
      select: { id: true, email: true, displayName: true, type: true, companyId: true, branchId: true }
    });
    if (!partner) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    res.json(
      serialize({
        partnerId: partner.id,
        email: partner.email,
        name: partner.displayName,
        type: partner.type,
        companyId: partner.companyId,
        branchId: partner.branchId ?? null
      })
    );
  } catch (e) {
    next(e);
  }
});

portalAuthRouter.get("/portal/auth/invite/:token", async (req, res, next) => {
  try {
    const tokenHash = hashRefreshToken(req.params.token);
    const invite = await (prisma as any).partnerPortalInvite.findUnique({
      where: { tokenHash },
      include: { partner: { select: { displayName: true, email: true, type: true } } }
    });
    if (!invite || invite.usedAt || invite.expiresAt.getTime() < Date.now()) {
      res.status(404).json({ error: "This invite link is invalid or has expired." });
      return;
    }
    res.json(
      serialize({
        name: invite.partner.displayName,
        email: invite.partner.email,
        type: invite.partner.type
      })
    );
  } catch (e) {
    next(e);
  }
});

const activateBody = z
  .object({
    password: z.string().min(8)
  })
  .strict();

portalAuthRouter.post("/portal/auth/invite/:token/activate", portalAuthLimiter, async (req, res, next) => {
  try {
    const body = activateBody.parse(req.body);
    const tokenHash = hashRefreshToken(String(req.params.token));

    const invite = await (prisma as any).partnerPortalInvite.findUnique({ where: { tokenHash } });
    if (!invite || invite.usedAt || invite.expiresAt.getTime() < Date.now()) {
      res.status(404).json({ error: "This invite link is invalid or has expired." });
      return;
    }

    const partner = await (prisma as any).partner.findUnique({
      where: { id: invite.partnerId },
      select: { id: true, type: true, companyId: true }
    });
    if (!partner || partner.type === "GUARANTOR" || !partner.companyId) {
      res.status(400).json({ error: "This account cannot activate portal access." });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await (tx as any).partner.update({
        where: { id: partner.id },
        data: { passwordHash: hashPassword(body.password) }
      });
      await (tx as any).partnerPortalInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date() }
      });
    });

    const session = await issuePortalSession(partner.id);
    setPortalAuthCookies(res, session.accessToken, session.refreshTokenRaw, session.refreshExpiresAt);
    res.status(204).send();
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    next(e);
  }
});
