import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { getRequestContext } from "../context.js";

export const dashboardRouter = Router();

// Receipts that should NOT be treated as customer income for dashboard KPIs.
const NON_INCOME_RECEIPT_TYPES = ["COMMISSION"] as const;

function parseYmdParam(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function rangeFromQuery(q: any): { from: Date | null; to: Date | null } {
  const from = parseYmdParam(q?.from);
  const to = parseYmdParam(q?.to);
  return { from, to };
}

/** Auto Finance dashboard — aggregate KPIs. */
dashboardRouter.get("/dashboard/summary", async (req, res, next) => {
  try {
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId ?? null;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });

    const tenantWhere = { companyId, ...(branchId ? { branchId } : {}) };
    const { from, to } = rangeFromQuery(req.query);
    const receivedAtRange =
      from && to ? { gte: from, lt: addDaysUtc(to, 1) } : undefined;
    const [contracts, receiptsAgg, outstanding, partners, vehicles] = await Promise.all([
      prisma.contract.count({ where: tenantWhere }),
      prisma.receipt.aggregate({
        where: {
          ...tenantWhere,
          state: { not: "CANCELLED" },
          receiptType: { notIn: [...NON_INCOME_RECEIPT_TYPES] as any },
          ...(receivedAtRange ? { receivedAt: receivedAtRange } : {})
        },
        _sum: { amount: true }
      }),
      prisma.installment.aggregate({
        where: tenantWhere,
        _sum: { totalDue: true, paidAmount: true }
      }),
      prisma.partner.count({ where: tenantWhere }),
      prisma.vehicle.count({ where: tenantWhere })
    ]);
    const receivable = (outstanding._sum.totalDue ?? new Prisma.Decimal(0)).sub(
      outstanding._sum.paidAmount ?? new Prisma.Decimal(0)
    );
    res.json(
      serialize({
        contractCount: contracts,
        partnerCount: partners,
        vehicleCount: vehicles,
        receiptTotal: receiptsAgg._sum.amount ?? new Prisma.Decimal(0),
        outstandingPrincipalInterest: receivable
      })
    );
  } catch (e) {
    next(e);
  }
});

/** Recent receipts for dashboard feed. */
dashboardRouter.get("/dashboard/recent-receipts", async (req, res, next) => {
  try {
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId ?? null;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });
    const limitRaw = Number(req.query.limit ?? 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 10;
    const tenantWhere = { companyId, ...(branchId ? { branchId } : {}) };
    const { from, to } = rangeFromQuery(req.query);
    const receivedAtRange = from && to ? { gte: from, lt: addDaysUtc(to, 1) } : undefined;

    const rows = await prisma.receipt.findMany({
      where: {
        ...tenantWhere,
        state: { not: "CANCELLED" },
        receiptType: { notIn: [...NON_INCOME_RECEIPT_TYPES] as any },
        ...(receivedAtRange ? { receivedAt: receivedAtRange } : {})
      },
      orderBy: { receivedAt: "desc" },
      take: limit,
      select: {
        id: true,
        amount: true,
        paymentMode: true,
        receiptType: true,
        receivedAt: true,
        reference: true,
        contract: {
          select: {
            id: true,
            contractNumber: true,
            buyer: { select: { id: true, displayName: true } }
          }
        }
      }
    });

    res.json(
      serialize(
        rows.map((r) => ({
          id: r.id,
          receivedAt: r.receivedAt,
          amount: r.amount,
          paymentMode: r.paymentMode,
          reference: r.reference,
          contractId: r.contract.id,
          contractNumber: r.contract.contractNumber,
          buyerId: r.contract.buyer.id,
          buyerName: r.contract.buyer.displayName
        }))
      )
    );
  } catch (e) {
    next(e);
  }
});

function tenantWhereOrThrow() {
  const companyId = getRequestContext()?.companyId;
  const branchId = getRequestContext()?.branchId ?? null;
  if (!companyId) throw new Error("Missing tenant");
  return { companyId, branchId };
}

function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** Income sources — receipts grouped by paymentMode (current month + previous month). */
dashboardRouter.get("/dashboard/income-sources", async (req, res, next) => {
  try {
    const { companyId, branchId } = tenantWhereOrThrow();
    const { from, to } = rangeFromQuery(req.query);
    const now = new Date();
    const curFrom = from && to ? from : startOfMonthUtc(now);
    const curToExcl = from && to ? addDaysUtc(to, 1) : undefined;
    // Previous period = same length immediately before current period (only when custom range is provided),
    // otherwise previous month.
    const rangeDays =
      from && to ? Math.max(1, Math.round((addDaysUtc(to, 1).getTime() - from.getTime()) / (24 * 60 * 60 * 1000))) : null;
    const prevFrom =
      from && to
        ? addDaysUtc(from, -rangeDays!)
        : startOfMonthUtc(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
    const prevToExcl =
      from && to ? from : curFrom;

    const curWhere: any = {
      companyId,
      ...(branchId ? { branchId } : {}),
      state: { not: "CANCELLED" },
      receiptType: { notIn: [...NON_INCOME_RECEIPT_TYPES] as any },
      receivedAt: { gte: curFrom, ...(curToExcl ? { lt: curToExcl } : {}) }
    };
    const prevWhere: any = {
      companyId,
      ...(branchId ? { branchId } : {}),
      state: { not: "CANCELLED" },
      receiptType: { notIn: [...NON_INCOME_RECEIPT_TYPES] as any },
      receivedAt: { gte: prevFrom, lt: prevToExcl }
    };

    const [cur, prevAgg] = await Promise.all([
      prisma.receipt.groupBy({
        by: ["paymentMode"],
        where: curWhere,
        _sum: { amount: true }
      }),
      prisma.receipt.aggregate({ where: prevWhere, _sum: { amount: true } })
    ]);

    const totalCurrent = cur.reduce((acc, r) => acc.add(r._sum.amount ?? new Prisma.Decimal(0)), new Prisma.Decimal(0));
    const totalPrev = prevAgg._sum.amount ?? new Prisma.Decimal(0);

    const pctChange =
      totalPrev.equals(0) ? null : Number(totalCurrent.sub(totalPrev).div(totalPrev).mul(100).toFixed(2));

    const sources = cur
      .map((r) => ({
        source: r.paymentMode || "UNKNOWN",
        amount: r._sum.amount ?? new Prisma.Decimal(0)
      }))
      .sort((a, b) => new Prisma.Decimal(b.amount).cmp(new Prisma.Decimal(a.amount)));

    res.json(
      serialize({
        total: totalCurrent,
        pctChangeVsPrevMonth: pctChange,
        sources
      })
    );
  } catch (e) {
    next(e);
  }
});

/** Monthly expenses — sums per month (last 6 months). */
dashboardRouter.get("/dashboard/monthly-expenses", async (req, res, next) => {
  try {
    const { companyId, branchId } = tenantWhereOrThrow();
    const { to } = rangeFromQuery(req.query);
    const anchor = to ?? new Date();
    // Use raw SQL for date_trunc groupings (Postgres).
    const rows = await prisma.$queryRaw<
      Array<{ month: Date; amount: Prisma.Decimal }>
    >`
      SELECT
        date_trunc('month', "expenseDate") AS "month",
        COALESCE(SUM("amount"), 0)::DECIMAL AS "amount"
      FROM "Expense"
      WHERE "companyId" = ${companyId}
        AND (${branchId}::text IS NULL OR "branchId" = ${branchId})
        AND "expenseDate" >= (date_trunc('month', ${anchor}::timestamptz) - interval '5 months')
        AND "expenseDate" < (date_trunc('month', ${anchor}::timestamptz) + interval '1 month')
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

/** Expense summary — top categories for current month. */
dashboardRouter.get("/dashboard/expense-summary", async (req, res, next) => {
  try {
    const { companyId, branchId } = tenantWhereOrThrow();
    const { from, to } = rangeFromQuery(req.query);
    const now = new Date();
    const fromD = from && to ? from : startOfMonthUtc(now);
    const toExcl = from && to ? addDaysUtc(to, 1) : undefined;

    const rows = await prisma.$queryRaw<
      Array<{ category: string; amount: Prisma.Decimal }>
    >`
      SELECT
        COALESCE(ec."name", 'Uncategorized') AS "category",
        COALESCE(SUM(e."amount"), 0)::DECIMAL AS "amount"
      FROM "Expense" e
      LEFT JOIN "ExpenseCategory" ec ON ec."id" = e."categoryId"
      WHERE e."companyId" = ${companyId}
        AND (${branchId}::text IS NULL OR e."branchId" = ${branchId})
        AND e."expenseDate" >= ${fromD}
        AND (${toExcl}::timestamptz IS NULL OR e."expenseDate" < ${toExcl})
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 8
    `;
    const total = rows.reduce((acc, r) => acc.add(r.amount ?? new Prisma.Decimal(0)), new Prisma.Decimal(0));
    res.json(serialize({ total, rows }));
  } catch (e) {
    next(e);
  }
});

/** Profit & Expense KPIs (current month vs previous month). */
dashboardRouter.get("/dashboard/profit-expense", async (req, res, next) => {
  try {
    const { companyId, branchId } = tenantWhereOrThrow();
    const now = new Date();
    const { from, to } = rangeFromQuery(req.query);
    const curFrom = from && to ? from : startOfMonthUtc(now);
    const curToExcl = from && to ? addDaysUtc(to, 1) : undefined;
    const rangeDays =
      from && to ? Math.max(1, Math.round((addDaysUtc(to, 1).getTime() - from.getTime()) / (24 * 60 * 60 * 1000))) : null;
    const prevFrom =
      from && to
        ? addDaysUtc(from, -rangeDays!)
        : startOfMonthUtc(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
    const prevToExcl = from && to ? from : curFrom;

    const receiptWhereCur: any = {
      companyId,
      ...(branchId ? { branchId } : {}),
      state: { not: "CANCELLED" },
      receiptType: { notIn: [...NON_INCOME_RECEIPT_TYPES] as any },
      receivedAt: { gte: curFrom, ...(curToExcl ? { lt: curToExcl } : {}) }
    };
    const receiptWherePrev: any = {
      companyId,
      ...(branchId ? { branchId } : {}),
      state: { not: "CANCELLED" },
      receiptType: { notIn: [...NON_INCOME_RECEIPT_TYPES] as any },
      receivedAt: { gte: prevFrom, lt: prevToExcl }
    };

    const expenseWhereCur: any = {
      companyId,
      ...(branchId ? { branchId } : {}),
      expenseDate: { gte: curFrom, ...(curToExcl ? { lt: curToExcl } : {}) }
    };
    const expenseWherePrev: any = {
      companyId,
      ...(branchId ? { branchId } : {}),
      expenseDate: { gte: prevFrom, lt: prevToExcl }
    };

    const [curReceipts, prevReceipts, curExpenses, prevExpenses] = await Promise.all([
      prisma.receipt.aggregate({ where: receiptWhereCur, _sum: { amount: true } }),
      prisma.receipt.aggregate({ where: receiptWherePrev, _sum: { amount: true } }),
      (prisma as any).expense.aggregate({ where: expenseWhereCur, _sum: { amount: true } }),
      (prisma as any).expense.aggregate({ where: expenseWherePrev, _sum: { amount: true } })
    ]);

    const rCur = curReceipts._sum.amount ?? new Prisma.Decimal(0);
    const rPrev = prevReceipts._sum.amount ?? new Prisma.Decimal(0);
    const eCur = curExpenses._sum.amount ?? new Prisma.Decimal(0);
    const ePrev = prevExpenses._sum.amount ?? new Prisma.Decimal(0);

    const profitCur = rCur.sub(eCur);
    const profitPrev = rPrev.sub(ePrev);

    const profitPct =
      profitPrev.equals(0) ? null : Number(profitCur.sub(profitPrev).div(profitPrev).mul(100).toFixed(2));
    const expensePct =
      ePrev.equals(0) ? null : Number(eCur.sub(ePrev).div(ePrev).mul(100).toFixed(2));

    res.json(
      serialize({
        netProfit: profitCur,
        netProfitPctChangeVsPrevMonth: profitPct,
        expenses: eCur,
        expensesPctChangeVsPrevMonth: expensePct
      })
    );
  } catch (e) {
    next(e);
  }
});
