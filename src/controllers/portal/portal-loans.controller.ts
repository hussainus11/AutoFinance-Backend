import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { serialize } from "../../serialize.js";
import { getPortalContext } from "../../portal-context.js";

export const portalLoansRouter = Router();

function summarizeInstallments(installments: { totalDue: Prisma.Decimal; paidAmount: Prisma.Decimal; status: string; dueDate: Date }[]) {
  const totalDue = installments.reduce((sum, i) => sum.add(i.totalDue), new Prisma.Decimal(0));
  const totalPaid = installments.reduce((sum, i) => sum.add(i.paidAmount), new Prisma.Decimal(0));
  const nextDue = installments
    .filter((i) => i.status === "PENDING" || i.status === "PARTIAL" || i.status === "OVERDUE")
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
  return {
    totalDue,
    totalPaid,
    outstanding: totalDue.sub(totalPaid),
    nextDueDate: nextDue?.dueDate ?? null
  };
}

/** Only ever returns contracts where the caller is the buyer — every query below is scoped
 *  by both companyId and buyerId explicitly (the portal doesn't go through the staff Prisma
 *  extension's auto-scoping, since that reads a different, staff-only request context). */
portalLoansRouter.get("/portal/loans", async (_req, res, next) => {
  try {
    const ctx = getPortalContext();
    if (!ctx) return res.status(401).json({ error: "Not authenticated" });

    const contracts = await prisma.contract.findMany({
      where: { companyId: ctx.companyId, buyerId: ctx.partnerId },
      select: {
        id: true,
        contractNumber: true,
        status: true,
        principalAmount: true,
        interestRateApr: true,
        tenureMonths: true,
        startDate: true,
        installments: { select: { totalDue: true, paidAmount: true, status: true, dueDate: true } }
      },
      orderBy: { startDate: "desc" }
    });

    const rows = contracts.map((c) => {
      const { installments, ...rest } = c;
      return { ...rest, ...summarizeInstallments(installments) };
    });

    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

portalLoansRouter.get("/portal/loans/:contractId", async (req, res, next) => {
  try {
    const ctx = getPortalContext();
    if (!ctx) return res.status(401).json({ error: "Not authenticated" });

    const contract = await prisma.contract.findFirst({
      where: { id: String(req.params.contractId), companyId: ctx.companyId, buyerId: ctx.partnerId },
      include: {
        installments: { orderBy: { sequence: "asc" } },
        receipts: {
          where: { state: { not: "CANCELLED" } },
          include: { allocations: true },
          orderBy: { receivedAt: "desc" }
        },
        vehicles: { include: { vehicle: { select: { make: true, model: true, year: true, vin: true } } } }
      }
    });
    if (!contract) return res.status(404).json({ error: "Loan not found" });

    const { installments, ...rest } = contract;
    res.json(serialize({ ...rest, ...summarizeInstallments(installments), installments }));
  } catch (e) {
    next(e);
  }
});

/** Buyer's overpayment/credit/refund ledger — CustomerCreditMovement links directly to the
 *  buyer, not through a single contract, so it's a separate endpoint rather than nested under
 *  a specific loan. */
portalLoansRouter.get("/portal/credits", async (_req, res, next) => {
  try {
    const ctx = getPortalContext();
    if (!ctx) return res.status(401).json({ error: "Not authenticated" });

    const movements = await prisma.customerCreditMovement.findMany({
      where: { companyId: ctx.companyId, buyerId: ctx.partnerId },
      include: {
        sourceContract: { select: { contractNumber: true } },
        targetContract: { select: { contractNumber: true } }
      },
      orderBy: { createdAt: "desc" }
    });

    const balance = movements.reduce((sum, m) => {
      if (m.type === "OVERPAYMENT") return sum.add(m.amount);
      return sum.sub(m.amount);
    }, new Prisma.Decimal(0));

    res.json(serialize({ balance, movements }));
  } catch (e) {
    next(e);
  }
});
