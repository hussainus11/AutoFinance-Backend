import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { allocateReceiptFifoInTx } from "../services/allocation.js";
import { syncContractOverdueStatusForContract } from "../services/collections.js";
import { getRequestContext } from "../context.js";

export const creditsRouter = Router();

function tenantOrThrow() {
  const companyId = getRequestContext()?.companyId;
  const branchId = getRequestContext()?.branchId ?? null;
  if (!companyId) throw new Error("Missing tenant");
  return { companyId, branchId };
}

function parseMoney(v: unknown): Prisma.Decimal {
  return new Prisma.Decimal(String(v ?? "").replace(/,/g, "").trim());
}

/** Buyer credit balance + movements (trackable). */
creditsRouter.get("/credits/balance", async (req, res, next) => {
  try {
    const { companyId, branchId } = tenantOrThrow();
    const buyerId = typeof req.query.buyerId === "string" ? req.query.buyerId.trim() : "";
    if (!buyerId) return res.status(400).json({ error: "Missing buyerId" });

    const where: any = { companyId, buyerId, ...(branchId ? { branchId } : {}) };
    const rows = await prisma.customerCreditMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200
    });
    const balance = rows.reduce((acc, r) => {
      const amt = r.amount ?? new Prisma.Decimal(0);
      if (r.type === "OVERPAYMENT") return acc.add(amt);
      return acc.sub(amt);
    }, new Prisma.Decimal(0));

    res.json(serialize({ buyerId, balance, rows }));
  } catch (e) {
    next(e);
  }
});

const applyBody = z
  .object({
    sourceReceiptId: z.string().uuid(),
    targetContractId: z.string().uuid(),
    amount: z.string().or(z.number())
  })
  .strict();

/** Apply customer credit (unallocated) from one receipt to another contract of same buyer. */
creditsRouter.post("/credits/apply", async (req, res, next) => {
  try {
    const body = applyBody.parse(req.body);
    const { companyId, branchId } = tenantOrThrow();
    const amt = parseMoney(body.amount);
    if (amt.lte(0)) return res.status(400).json({ error: "Amount must be > 0" });

    const out = await prisma.$transaction(async (tx: any) => {
      const src = await tx.receipt.findUnique({
        where: { id: body.sourceReceiptId },
        include: { contract: { select: { id: true, buyerId: true, contractNumber: true, status: true } } }
      });
      if (!src) throw new Error("Source receipt not found");
      if (String(src.state) === "CANCELLED") throw new Error("Source receipt is cancelled");
      const available = new Prisma.Decimal(src.unallocatedAmount ?? 0);
      if (available.lt(amt)) throw new Error("Insufficient unallocated credit on source receipt");

      const tgt = await tx.contract.findUnique({
        where: { id: body.targetContractId },
        select: { id: true, buyerId: true, contractNumber: true, status: true }
      });
      if (!tgt) throw new Error("Target contract not found");
      if (tgt.buyerId !== src.contract.buyerId) throw new Error("Target contract must belong to the same buyer");
      if (["REPOSSESSED", "CLOSED"].includes(String((tgt as any).status))) {
        throw new Error("Cannot apply credit to Repossessed/Closed contracts");
      }

      const creditReceipt = await tx.receipt.create({
        data: {
          contractId: tgt.id,
          amount: amt,
          receiptType: "MANUAL",
          paymentMode: "CREDIT",
          reference: `CREDIT_APPLY:${String(src.id).slice(0, 8)}`,
          note: `Applied from receipt ${String(src.id).slice(0, 8)}`
        } as any
      });

      await allocateReceiptFifoInTx(tx, creditReceipt.id);

      const newAvail = available.sub(amt);
      await tx.receipt.update({
        where: { id: src.id },
        data: { unallocatedAmount: newAvail } as any
      });

      // Track movement
      await tx.customerCreditMovement.create({
        data: {
          companyId,
          ...(branchId ? { branchId } : {}),
          buyerId: src.contract.buyerId,
          type: "APPLY_TO_CONTRACT",
          amount: amt,
          sourceReceiptId: src.id,
          sourceContractId: src.contract.id,
          targetContractId: tgt.id,
          note: `Applied to contract ${tgt.contractNumber}`
        } as any
      });

      // Ensure OVERPAYMENT movement matches current unallocated on source receipt.
      await tx.customerCreditMovement.upsert({
        where: { companyId_sourceReceiptId_type: { companyId, sourceReceiptId: src.id, type: "OVERPAYMENT" } } as any,
        create: {
          companyId,
          ...(branchId ? { branchId } : {}),
          buyerId: src.contract.buyerId,
          type: "OVERPAYMENT",
          amount: newAvail,
          sourceReceiptId: src.id,
          sourceContractId: src.contract.id,
          note: `Overpayment on receipt ${String(src.id).slice(0, 8)}`
        } as any,
        update: { amount: newAvail } as any
      });

      return { sourceReceiptId: src.id, targetReceiptId: creditReceipt.id, targetContractId: tgt.id, contractId: tgt.id };
    });

    await syncContractOverdueStatusForContract(out.contractId);
    res.json(serialize({ ok: true, ...out }));
  } catch (e) {
    next(e);
  }
});

const refundBody = z
  .object({
    sourceReceiptId: z.string().uuid(),
    amount: z.string().or(z.number()),
    note: z.string().optional().nullable()
  })
  .strict();

/** Refund customer credit back to customer (reduces unallocated). */
creditsRouter.post("/credits/refund", async (req, res, next) => {
  try {
    const body = refundBody.parse(req.body);
    const { companyId, branchId } = tenantOrThrow();
    const amt = parseMoney(body.amount);
    if (amt.lte(0)) return res.status(400).json({ error: "Amount must be > 0" });

    const out = await prisma.$transaction(async (tx: any) => {
      const src = await tx.receipt.findUnique({
        where: { id: body.sourceReceiptId },
        include: { contract: { select: { id: true, buyerId: true, contractNumber: true } } }
      });
      if (!src) throw new Error("Source receipt not found");
      if (String(src.state) === "CANCELLED") throw new Error("Source receipt is cancelled");
      const available = new Prisma.Decimal(src.unallocatedAmount ?? 0);
      if (available.lt(amt)) throw new Error("Insufficient unallocated credit on source receipt");

      const newAvail = available.sub(amt);
      await tx.receipt.update({
        where: { id: src.id },
        data: { unallocatedAmount: newAvail } as any
      });

      await tx.customerCreditMovement.create({
        data: {
          companyId,
          ...(branchId ? { branchId } : {}),
          buyerId: src.contract.buyerId,
          type: "REFUND",
          amount: amt,
          sourceReceiptId: src.id,
          sourceContractId: src.contract.id,
          note: body.note ?? "Refund"
        } as any
      });

      await tx.customerCreditMovement.upsert({
        where: { companyId_sourceReceiptId_type: { companyId, sourceReceiptId: src.id, type: "OVERPAYMENT" } } as any,
        create: {
          companyId,
          ...(branchId ? { branchId } : {}),
          buyerId: src.contract.buyerId,
          type: "OVERPAYMENT",
          amount: newAvail,
          sourceReceiptId: src.id,
          sourceContractId: src.contract.id,
          note: `Overpayment on receipt ${String(src.id).slice(0, 8)}`
        } as any,
        update: { amount: newAvail } as any
      });

      return { sourceReceiptId: src.id, remainingUnallocated: newAvail, buyerId: src.contract.buyerId };
    });

    res.json(serialize({ ok: true, ...out }));
  } catch (e) {
    next(e);
  }
});

