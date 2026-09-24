import { Router } from "express";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { markOverdueInstallmentsForTenant } from "../services/collections.js";
import { getRequestContext } from "../context.js";

export const collectionsRouter = Router();

/** Collections page — overdue installments for recovery workflows. */
collectionsRouter.get("/collections/overdue", async (_req, res, next) => {
  try {
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId ?? null;
    if (!companyId) {
      res.status(400).json({ error: "Missing tenant. Please login again." });
      return;
    }

    await markOverdueInstallmentsForTenant({ companyId, branchId });
    const rows = await prisma.installment.findMany({
      where: {
        status: "OVERDUE",
        contract: {
          company: { is: { id: companyId } },
          ...(branchId ? { branch: { is: { id: branchId } } } : {})
        }
      } as any,
      include: { contract: { include: { buyer: true } } },
      orderBy: { dueDate: "asc" }
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});
