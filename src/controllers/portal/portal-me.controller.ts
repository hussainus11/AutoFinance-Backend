import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { serialize } from "../../serialize.js";
import { hashPassword, verifyPassword } from "../../auth/password.js";
import { revokeAllPortalSessionsForPartner } from "../../portal-auth/session.js";
import { getPortalContext } from "../../portal-context.js";

export const portalMeRouter = Router();

portalMeRouter.get("/portal/me", async (_req, res, next) => {
  try {
    const ctx = getPortalContext();
    if (!ctx) return res.status(401).json({ error: "Not authenticated" });

    const partner = await prisma.partner.findUnique({
      where: { id: ctx.partnerId },
      select: {
        id: true,
        displayName: true,
        type: true,
        email: true,
        phone: true,
        phones: { select: { phoneNumber: true, phoneType: true, isPrimary: true } },
        emails: { select: { email: true, emailType: true, isPrimary: true } },
        addresses: { select: { addressType: true, line1: true, line2: true, city: true, stateRegion: true, postalCode: true, country: true, isPrimary: true } }
      }
    });
    if (!partner) return res.status(401).json({ error: "Not authenticated" });

    res.json(serialize(partner));
  } catch (e) {
    next(e);
  }
});

const changePasswordBody = z
  .object({
    currentPassword: z.string().min(1),
    password: z.string().min(8)
  })
  .strict();

portalMeRouter.post("/portal/me/change-password", async (req, res, next) => {
  try {
    const ctx = getPortalContext();
    if (!ctx) return res.status(401).json({ error: "Not authenticated" });

    const body = changePasswordBody.parse(req.body);
    const partner = await prisma.partner.findUnique({
      where: { id: ctx.partnerId },
      select: { id: true, passwordHash: true }
    });
    if (!partner) return res.status(401).json({ error: "Not authenticated" });
    if (!verifyPassword(body.currentPassword, partner.passwordHash)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    await prisma.partner.update({
      where: { id: partner.id },
      data: { passwordHash: hashPassword(body.password) }
    });
    await revokeAllPortalSessionsForPartner(partner.id);

    res.status(204).send();
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    next(e);
  }
});
