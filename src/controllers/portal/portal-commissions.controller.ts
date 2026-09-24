import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { serialize } from "../../serialize.js";
import { getPortalContext } from "../../portal-context.js";

export const portalCommissionsRouter = Router();

/** Only ever returns commissions where the caller is the agent — scoped explicitly by
 *  companyId + agentId, same defense-in-depth reasoning as portal-loans.controller.ts. */
portalCommissionsRouter.get("/portal/commissions", async (_req, res, next) => {
  try {
    const ctx = getPortalContext();
    if (!ctx) return res.status(401).json({ error: "Not authenticated" });

    const commissions = await prisma.commission.findMany({
      where: { companyId: ctx.companyId, agentId: ctx.partnerId },
      include: {
        contract: {
          select: { contractNumber: true, status: true, buyer: { select: { displayName: true } } }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    const pending = commissions
      .filter((c) => c.status === "PENDING")
      .reduce((sum, c) => sum.add(c.amount), new Prisma.Decimal(0));
    const paid = commissions
      .filter((c) => c.status === "PAID")
      .reduce((sum, c) => sum.add(c.amount), new Prisma.Decimal(0));

    res.json(serialize({ pending, paid, commissions }));
  } catch (e) {
    next(e);
  }
});
