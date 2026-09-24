import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { getRequestContext } from "../context.js";
import {
  allocateReceiptFifo,
  allocateReceiptManualToInstallment,
  cancelReceipt,
  deallocateReceipt
} from "../services/allocation.js";
import { postReceiptJournalEntryInTx } from "../services/accounting-posting.js";
import { connectById } from "../services/tenant-helpers.js";
import { allocateReceiptFifoInTx } from "../services/allocation.js";
import { syncContractOverdueStatusForContract } from "../services/collections.js";
import { notifyAdminUsers } from "../services/notifications.js";

export const receiptsRouter = Router();

const receiptCreate = z.object({
  contractId: z.string().uuid(),
  receiptType: z.enum(["NORMAL", "DOWN_PAYMENT", "COMMISSION", "MANUAL"]).optional(),
  amount: z.string().or(z.number()),
  paymentMode: z.string().min(1),
  reference: z.string().optional().nullable(),
  receivedAt: z.string().datetime().optional(),
  note: z.string().optional().nullable()
});

/** Payments & receipts pages — receipts CRUD + FIFO allocate / deallocate / cancel. */
receiptsRouter.get("/receipts", async (req, res, next) => {
  try {
    const contractId = typeof req.query.contractId === "string" ? req.query.contractId.trim() : "";
    const receiptTypeQ = typeof req.query.receiptType === "string" ? req.query.receiptType.trim().toUpperCase() : "";
    const allowedType = new Set(["NORMAL", "DOWN_PAYMENT", "COMMISSION", "MANUAL"]);
    const buildCompatTypeWhere = (): Record<string, unknown> | undefined => {
      if (!receiptTypeQ || !allowedType.has(receiptTypeQ)) return undefined;
      // Fallback when Prisma client is out-of-date (no receiptType field):
      // infer type from stable fields used by our code paths.
      if (receiptTypeQ === "COMMISSION") {
        return {
          OR: [
            { paymentMode: "COMMISSION" },
            { reference: { contains: "AUTO:COMMISSION" } }
          ]
        };
      }
      if (receiptTypeQ === "DOWN_PAYMENT") {
        return {
          OR: [
            { paymentMode: "DOWNPAYMENT" },
            { reference: { contains: "AUTO:DOWNPAYMENT" } }
          ]
        };
      }
      // NORMAL / MANUAL cannot be reliably inferred without receiptType; return undefined.
      return undefined;
    };

    const baseWhere =
      contractId || (receiptTypeQ && allowedType.has(receiptTypeQ))
        ? {
            ...(contractId ? { contractId } : {}),
            ...(receiptTypeQ && allowedType.has(receiptTypeQ) ? { receiptType: receiptTypeQ as any } : {})
          }
        : undefined;

    const include = {
      contract: { include: { buyer: true, agent: true } },
      allocations: { include: { installment: true } }
    };

    let rows: unknown;
    try {
      rows = await prisma.receipt.findMany({
        where: baseWhere as any,
        include,
        orderBy: { createdAt: "desc" }
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Unknown argument `receiptType`") || msg.includes("Unknown argument 'receiptType'")) {
        const compatTypeWhere = buildCompatTypeWhere();
        rows = await prisma.receipt.findMany({
          where:
            contractId || compatTypeWhere
              ? {
                  ...(contractId ? { contractId } : {}),
                  ...(compatTypeWhere ?? {})
                }
              : undefined,
          include,
          orderBy: { createdAt: "desc" }
        });
      } else {
        throw e;
      }
    }
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

receiptsRouter.get("/receipts/:id", async (req, res, next) => {
  try {
    const row = await prisma.receipt.findUnique({
      where: { id: req.params.id },
      include: {
        contract: { include: { buyer: true, agent: true } },
        allocations: { include: { installment: true } }
      }
    });
    if (!row) return res.status(404).json({ error: "Receipt not found" });
    res.json(serialize(row));
  } catch (e) {
    next(e);
  }
});

receiptsRouter.post("/receipts", async (req, res, next) => {
  try {
    const body = receiptCreate.parse(req.body);
    const companyId = getRequestContext()?.companyId;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });

    // Block receipts against repossessed/closed contracts.
    const contract = await prisma.contract.findUnique({
      where: { id: body.contractId },
      select: { id: true, status: true }
    });
    if (!contract) return res.status(404).json({ error: "Contract not found" });
    if (["REPOSSESSED", "CLOSED"].includes(String((contract as any).status))) {
      return res.status(400).json({ error: "Receipts are not allowed for Repossessed/Closed contracts." });
    }

    // Auto numbering for receipts (manual override disabled by design):
    // If reference is not provided and receipt is not an AUTO:* type, generate RCPT-xxxx and bump counter.
    const shouldAutoRef =
      !body.reference &&
      !["COMMISSION", "DOWN_PAYMENT"].includes((body.receiptType ?? "NORMAL") as any) &&
      (body.paymentMode ?? "").toUpperCase() !== "COMMISSION" &&
      (body.paymentMode ?? "").toUpperCase() !== "DOWNPAYMENT";

    const CFG_RECEIPT_PREFIX = "numbering.receipt.prefix";
    const CFG_RECEIPT_NEXT = "numbering.receipt.next";

    const pad4 = (n: number) => String(n).padStart(4, "0");
    const nextReceiptRef = async (): Promise<string | undefined> => {
      try {
        return await prisma.$transaction(async (tx: any) => {
          const prefixRows = (await tx.$queryRawUnsafe(
            `SELECT "value" FROM "SystemConfig" WHERE "companyId" = $1 AND "key" = $2 LIMIT 1`,
            companyId,
            CFG_RECEIPT_PREFIX
          )) as Array<{ value: string }>;
          const prefix = (prefixRows?.[0]?.value ?? "RCPT-").trim() || "RCPT-";

          const nextRows = (await tx.$queryRawUnsafe(
            `SELECT "value" FROM "SystemConfig" WHERE "companyId" = $1 AND "key" = $2 FOR UPDATE`,
            companyId,
            CFG_RECEIPT_NEXT
          )) as Array<{ value: string }>;
          const current = Number(String(nextRows?.[0]?.value ?? "1").replace(/,/g, "").trim());
          const n = Number.isFinite(current) && current > 0 ? Math.floor(current) : 1;

          await tx.$queryRawUnsafe(
            `
            INSERT INTO "SystemConfig" ("companyId","key","value","updatedAt")
            VALUES ($1,$2,$3,NOW())
            ON CONFLICT ("companyId","key") DO UPDATE SET
              "value" = EXCLUDED."value",
              "updatedAt" = NOW()
            `,
            companyId,
            CFG_RECEIPT_NEXT,
            String(n + 1)
          );

          return `${prefix}${pad4(n)}`;
        });
      } catch {
        return undefined;
      }
    };

    const autoRef = shouldAutoRef ? await nextReceiptRef() : undefined;

    const out = await prisma.$transaction(async (tx: any) => {
      let row: any;
      try {
        row = await tx.receipt.create({
          data: {
            contract: connectById(body.contractId),
            amount: new Prisma.Decimal(String(body.amount)),
            receiptType: body.receiptType ?? "NORMAL",
            paymentMode: body.paymentMode,
            reference: body.reference ?? autoRef ?? undefined,
            receivedAt: body.receivedAt ? new Date(body.receivedAt) : undefined,
            note: body.note ?? undefined
          } as any
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Unknown argument `receiptType`") || msg.includes("Unknown argument 'receiptType'")) {
          const fallbackReference =
            body.reference ??
            autoRef ??
            (body.receiptType === "COMMISSION"
              ? "AUTO:COMMISSION"
              : body.receiptType === "DOWN_PAYMENT"
                ? "AUTO:DOWNPAYMENT"
                : undefined);
          row = await tx.receipt.create({
            data: {
              contract: connectById(body.contractId),
              amount: new Prisma.Decimal(String(body.amount)),
              paymentMode: body.paymentMode,
              reference: fallbackReference,
              receivedAt: body.receivedAt ? new Date(body.receivedAt) : undefined,
              note: body.note ?? undefined
            } as any
          });
        } else {
          throw e;
        }
      }

      if ((body.receiptType ?? "NORMAL") === "NORMAL") {
        await allocateReceiptFifoInTx(tx, row.id);
        await postReceiptJournalEntryInTx(tx, row.id);
      }

      const updated = await tx.receipt.findUnique({
        where: { id: row.id },
        include: { allocations: { include: { installment: true } }, contract: { include: { buyer: true } } }
      });
      return { receipt: updated ?? row, contractId: row.contractId as string };
    });

    await syncContractOverdueStatusForContract(out.contractId);
    await notifyAdminUsers({
      type: "RECEIPT_CREATED",
      title: "Receipt added",
      message: `Amount: ${String(body.amount)}`,
      href: "/dashboard/autofinance/payments/receipts"
    });
    res.status(201).json(serialize(out.receipt));
  } catch (e) {
    next(e);
  }
});

receiptsRouter.post("/receipts/:id/allocate", async (req, res, next) => {
  try {
    const out = await allocateReceiptFifo(req.params.id);
    const row = await prisma.receipt.findUnique({
      where: { id: req.params.id },
      include: { allocations: { include: { installment: true } }, contract: true }
    });
    await notifyAdminUsers({
      type: "RECEIPT_UPDATED",
      title: "Receipt allocated",
      message: `Receipt ${req.params.id.slice(0, 8)}`,
      href: "/dashboard/autofinance/payments/receipts"
    });
    res.json(serialize({ result: out, receipt: row }));
  } catch (e) {
    next(e);
  }
});

receiptsRouter.post("/receipts/:id/deallocate", async (req, res, next) => {
  try {
    await deallocateReceipt(req.params.id);
    const row = await prisma.receipt.findUnique({
      where: { id: req.params.id },
      include: { allocations: true, contract: true }
    });
    await notifyAdminUsers({
      type: "RECEIPT_UPDATED",
      title: "Receipt deallocated",
      message: `Receipt ${req.params.id.slice(0, 8)}`,
      href: "/dashboard/autofinance/payments/receipts"
    });
    res.json(serialize({ ok: true, receipt: row }));
  } catch (e) {
    next(e);
  }
});

receiptsRouter.post("/receipts/:id/manual-allocate", async (req, res, next) => {
  try {
    const body = z.object({ installmentId: z.string().uuid() }).parse(req.body);
    const current = await prisma.receipt.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Receipt not found" });
    if (current.state !== "DEALLOCATED") {
      return res.status(400).json({ error: "Receipt must be DEALLOCATED to manually reallocate" });
    }
    // Mark as MANUAL so UI can distinguish it.
    try {
      await prisma.receipt.update({
        where: { id: req.params.id },
        data: { receiptType: "MANUAL" as any } as any
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!(msg.includes("Unknown argument `receiptType`") || msg.includes("Unknown argument 'receiptType'"))) {
        throw e;
      }
      // Prisma client out-of-date: skip marking receiptType.
    }
    const out = await allocateReceiptManualToInstallment(req.params.id, body.installmentId);
    const row = await prisma.receipt.findUnique({
      where: { id: req.params.id },
      include: { allocations: { include: { installment: true } }, contract: { include: { buyer: true } } }
    });
    await notifyAdminUsers({
      type: "RECEIPT_UPDATED",
      title: "Receipt manually allocated",
      message: `Receipt ${req.params.id.slice(0, 8)}`,
      href: "/dashboard/autofinance/payments/receipts"
    });
    res.json(serialize({ ok: true, result: out, receipt: row }));
  } catch (e) {
    next(e);
  }
});

receiptsRouter.post("/receipts/:id/cancel", async (req, res, next) => {
  try {
    await cancelReceipt(req.params.id);
    const row = await prisma.receipt.findUnique({ where: { id: req.params.id } });
    await notifyAdminUsers({
      type: "RECEIPT_UPDATED",
      title: "Receipt cancelled",
      message: `Receipt ${req.params.id.slice(0, 8)}`,
      href: "/dashboard/autofinance/payments/receipts"
    });
    res.json(serialize({ ok: true, receipt: row }));
  } catch (e) {
    next(e);
  }
});

/** Allocations page — receipt → installment allocation lines. */
receiptsRouter.get("/allocations", async (req, res, next) => {
  try {
    const receiptId = typeof req.query.receiptId === "string" ? req.query.receiptId.trim() : "";
    const rows = await prisma.receiptAllocation.findMany({
      where: receiptId ? { receiptId } : undefined,
      include: {
        receipt: true,
        installment: { include: { contract: true } }
      },
      orderBy: { createdAt: "desc" }
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});
