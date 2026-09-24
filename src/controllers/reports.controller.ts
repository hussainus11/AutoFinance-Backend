import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { getRequestContext } from "../context.js";

export const reportsRouter = Router();

function tenantCompanyIdOrThrow(): string {
  const companyId = getRequestContext()?.companyId;
  if (!companyId) throw new Error("Missing tenant");
  return companyId;
}

function parseDateQ(v: unknown): Date | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseStringQ(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length ? s : undefined;
}

/** Reports page — interest projections (approximate). */
reportsRouter.get("/reports/summary", async (_req, res, next) => {
  try {
    const installments = await prisma.installment.findMany();
    let interestProjected = new Prisma.Decimal(0);
    let interestPaid = new Prisma.Decimal(0);
    for (const i of installments) {
      interestProjected = interestProjected.add(i.interestDue);
      const paidOnI = i.paidAmount;
      const ratio = i.totalDue.gt(0) ? paidOnI.div(i.totalDue) : new Prisma.Decimal(0);
      interestPaid = interestPaid.add(i.interestDue.mul(ratio));
    }
    res.json(
      serialize({
        interestProjected,
        interestRecognizedApprox: interestPaid
      })
    );
  } catch (e) {
    next(e);
  }
});

/** Financial: Receipts register */
reportsRouter.get("/reports/financial/receipts-register", async (req, res, next) => {
  try {
    const companyId = tenantCompanyIdOrThrow();
    const from = parseDateQ(req.query.from);
    const to = parseDateQ(req.query.to);
    const receiptType = parseStringQ(req.query.receiptType);
    const paymentMode = parseStringQ(req.query.paymentMode);
    const contractNumber = parseStringQ(req.query.contractNumber);
    const contractId = parseStringQ(req.query.contractId);

    const and: any[] = [{ companyId }];
    if (from) and.push({ receivedAt: { gte: from } });
    if (to) and.push({ receivedAt: { lte: to } });
    if (receiptType) and.push({ receiptType });
    if (paymentMode) and.push({ paymentMode });
    if (contractId) and.push({ contractId });
    if (contractNumber) and.push({ contract: { contractNumber: { contains: contractNumber, mode: "insensitive" } } });

    const rows = await prisma.receipt.findMany({
      where: { AND: and } as any,
      include: { contract: { include: { buyer: true, agent: true } } },
      orderBy: { receivedAt: "desc" }
    });

    res.json(
      serialize(
        rows.map((r) => ({
          id: r.id,
          receivedAt: r.receivedAt,
          receiptType: (r as any).receiptType,
          paymentMode: r.paymentMode,
          reference: r.reference,
          amount: r.amount,
          contractNumber: (r as any).contract?.contractNumber,
          buyer: (r as any).contract?.buyer?.displayName ?? null,
          agent: (r as any).contract?.agent?.displayName ?? null,
          createdByName: (r as any).createdByName ?? null
        }))
      )
    );
  } catch (e) {
    next(e);
  }
});

/** Financial: Expenses register */
reportsRouter.get("/reports/financial/expenses-register", async (req, res, next) => {
  try {
    const companyId = tenantCompanyIdOrThrow();
    const from = parseDateQ(req.query.from);
    const to = parseDateQ(req.query.to);
    const categoryId = parseStringQ(req.query.categoryId);
    const vendor = parseStringQ(req.query.vendor);
    const paymentMode = parseStringQ(req.query.paymentMode);
    const q = parseStringQ(req.query.q);

    const and: any[] = [{ companyId }];
    if (from) and.push({ expenseDate: { gte: from } });
    if (to) and.push({ expenseDate: { lte: to } });
    if (categoryId) and.push({ categoryId });
    if (vendor) and.push({ vendor: { contains: vendor, mode: "insensitive" } });
    if (paymentMode) and.push({ paymentMode });
    if (q) {
      and.push({
        OR: [
          { description: { contains: q, mode: "insensitive" } },
          { vendor: { contains: q, mode: "insensitive" } },
          { reference: { contains: q, mode: "insensitive" } }
        ]
      });
    }

    const rows = await prisma.expense.findMany({
      where: { AND: and } as any,
      include: { category: true },
      orderBy: { expenseDate: "desc" }
    });
    res.json(
      serialize(
        rows.map((e: any) => ({
          id: e.id,
          expenseDate: e.expenseDate,
          category: e.category?.name ?? null,
          vendor: e.vendor ?? null,
          paymentMode: e.paymentMode ?? null,
          description: e.description,
          amount: e.amount,
          createdByName: e.createdByName ?? null
        }))
      )
    );
  } catch (e) {
    next(e);
  }
});

/** Financial: Cash/Bank summary */
reportsRouter.get("/reports/financial/cash-bank-summary", async (req, res, next) => {
  try {
    const companyId = tenantCompanyIdOrThrow();
    const from = parseDateQ(req.query.from);
    const to = parseDateQ(req.query.to);
    const and: any[] = [{ companyId }];
    if (from) and.push({ receivedAt: { gte: from } });
    if (to) and.push({ receivedAt: { lte: to } });

    const groups = await prisma.receipt.groupBy({
      by: ["paymentMode"],
      where: { AND: and } as any,
      _sum: { amount: true },
      _count: { _all: true }
    });
    res.json(
      serialize(
        groups.map((g) => ({
          paymentMode: g.paymentMode,
          count: g._count?._all ?? 0,
          totalAmount: g._sum?.amount ?? new Prisma.Decimal(0)
        }))
      )
    );
  } catch (e) {
    next(e);
  }
});

/** Financial: Commission summary */
reportsRouter.get("/reports/financial/commission-summary", async (req, res, next) => {
  try {
    const companyId = tenantCompanyIdOrThrow();
    const from = parseDateQ(req.query.from);
    const to = parseDateQ(req.query.to);
    const agentId = parseStringQ(req.query.agentId);
    const status = parseStringQ(req.query.status);

    const and: any[] = [{ companyId }];
    if (from) and.push({ createdAt: { gte: from } });
    if (to) and.push({ createdAt: { lte: to } });
    if (agentId) and.push({ agentId });
    if (status) and.push({ status });

    const rows = await prisma.commission.findMany({
      where: { AND: and } as any,
      include: { agent: true, contract: true },
      orderBy: { createdAt: "desc" }
    });
    res.json(
      serialize(
        rows.map((r: any) => ({
          id: r.id,
          createdAt: r.createdAt,
          status: r.status,
          amount: r.amount,
          paidAt: r.paidAt,
          agent: r.agent?.displayName ?? null,
          contractNumber: r.contract?.contractNumber ?? null,
          createdByName: r.createdByName ?? null
        }))
      )
    );
  } catch (e) {
    next(e);
  }
});

/** Financial: Profit & Loss (cash basis, based on allocations + expenses) */
reportsRouter.get("/reports/financial/profit-loss", async (req, res, next) => {
  try {
    const companyId = tenantCompanyIdOrThrow();
    const from = parseDateQ(req.query.from);
    const to = parseDateQ(req.query.to);
    const andReceipts: any[] = [{ companyId }];
    if (from) andReceipts.push({ receipt: { receivedAt: { gte: from } } });
    if (to) andReceipts.push({ receipt: { receivedAt: { lte: to } } });

    const alloc = await prisma.receiptAllocation.groupBy({
      by: ["component"],
      where: { AND: andReceipts } as any,
      _sum: { amount: true }
    });

    const andExp: any[] = [{ companyId }];
    if (from) andExp.push({ expenseDate: { gte: from } });
    if (to) andExp.push({ expenseDate: { lte: to } });
    const exp = await prisma.expense.aggregate({
      where: { AND: andExp } as any,
      _sum: { amount: true }
    });

    const interest = alloc.find((x) => String(x.component) === "INTEREST")?._sum?.amount ?? new Prisma.Decimal(0);
    const principal = alloc.find((x) => String(x.component) === "PRINCIPAL")?._sum?.amount ?? new Prisma.Decimal(0);
    const expenses = exp._sum?.amount ?? new Prisma.Decimal(0);

    res.json(
      serialize({
        principalCollected: principal,
        profitCollected: interest,
        expenses,
        netProfit: interest.sub(expenses)
      })
    );
  } catch (e) {
    next(e);
  }
});

/** Financial: Trial balance (posted journal only) */
reportsRouter.get("/reports/financial/trial-balance", async (req, res, next) => {
  try {
    const companyId = tenantCompanyIdOrThrow();
    const from = parseDateQ(req.query.from);
    const to = parseDateQ(req.query.to);

    const where: any = {
      companyId,
      entry: {
        status: "POSTED",
        ...(from ? { entryDate: { gte: from } } : {}),
        ...(to ? { entryDate: { ...(from ? { gte: from } : {}), lte: to } } : {})
      }
    };

    const grouped = await prisma.journalLine.groupBy({
      by: ["accountId"],
      where,
      _sum: { debit: true, credit: true }
    });

    const accountIds = grouped.map((g) => g.accountId);
    const accounts = await prisma.accountingAccount.findMany({
      where: { companyId, id: { in: accountIds } } as any,
      orderBy: [{ code: "asc" }, { name: "asc" }]
    });
    const byId = new Map(accounts.map((a: any) => [a.id, a]));

    const rows = grouped
      .map((g) => {
        const a: any = byId.get(g.accountId);
        const debit = g._sum?.debit ?? new Prisma.Decimal(0);
        const credit = g._sum?.credit ?? new Prisma.Decimal(0);
        const net = new Prisma.Decimal(debit).sub(new Prisma.Decimal(credit));
        const debitBalance = net.gte(0) ? net : new Prisma.Decimal(0);
        const creditBalance = net.lt(0) ? net.mul(-1) : new Prisma.Decimal(0);
        return {
          accountCode: a?.code ?? "",
          accountName: a?.name ?? "",
          accountType: a?.type ?? "",
          debitTotal: debit,
          creditTotal: credit,
          debitBalance,
          creditBalance
        };
      })
      .sort((x, y) => String(x.accountCode).localeCompare(String(y.accountCode)));

    const totals = rows.reduce(
      (acc, r) => ({
        debitTotal: acc.debitTotal.add(r.debitTotal),
        creditTotal: acc.creditTotal.add(r.creditTotal),
        debitBalance: acc.debitBalance.add(r.debitBalance),
        creditBalance: acc.creditBalance.add(r.creditBalance)
      }),
      {
        debitTotal: new Prisma.Decimal(0),
        creditTotal: new Prisma.Decimal(0),
        debitBalance: new Prisma.Decimal(0),
        creditBalance: new Prisma.Decimal(0)
      }
    );

    res.json(serialize({ rows, totals }));
  } catch (e) {
    next(e);
  }
});

/** Financial: Balance sheet snapshot (as-of, posted journal only) */
reportsRouter.get("/reports/financial/balance-sheet", async (req, res, next) => {
  try {
    const companyId = tenantCompanyIdOrThrow();
    const asOf = parseDateQ(req.query.asOf) ?? new Date();
    const from = parseDateQ(req.query.from); // optional, for net income YTD; default start-of-year

    const grouped = await prisma.journalLine.groupBy({
      by: ["accountId"],
      where: { companyId, entry: { status: "POSTED", entryDate: { lte: asOf } } } as any,
      _sum: { debit: true, credit: true }
    });

    const accountIds = grouped.map((g) => g.accountId);
    const accounts = await prisma.accountingAccount.findMany({
      where: { companyId, id: { in: accountIds } } as any
    });
    const byId = new Map(accounts.map((a: any) => [a.id, a]));

    const balanceFor = (a: any, debit: any, credit: any) => {
      const d = new Prisma.Decimal(debit ?? 0);
      const c = new Prisma.Decimal(credit ?? 0);
      const nb = String(a?.normalBalance ?? "DEBIT");
      // Return "positive in normal direction".
      return nb === "CREDIT" ? c.sub(d) : d.sub(c);
    };

    const rowsAll = grouped
      .map((g) => {
        const a: any = byId.get(g.accountId);
        const type = String(a?.type ?? "");
        const debit = g._sum?.debit ?? new Prisma.Decimal(0);
        const credit = g._sum?.credit ?? new Prisma.Decimal(0);
        const amount = balanceFor(a, debit, credit);
        return {
          accountId: g.accountId,
          accountCode: a?.code ?? "",
          accountName: a?.name ?? "",
          accountType: type,
          normalBalance: String(a?.normalBalance ?? ""),
          amount
        };
      })
      .filter((r) => new Prisma.Decimal(r.amount).abs().gt(0));

    const bsRows = rowsAll
      .filter((r) => ["ASSET", "LIABILITY", "EQUITY"].includes(String(r.accountType)))
      .sort((x, y) => String(x.accountCode).localeCompare(String(y.accountCode)));

    const assets = bsRows.filter((r) => r.accountType === "ASSET");
    const liabilities = bsRows.filter((r) => r.accountType === "LIABILITY");
    const equityBase = bsRows.filter((r) => r.accountType === "EQUITY");

    const sum = (xs: any[]) => xs.reduce((acc, r) => acc.add(new Prisma.Decimal(r.amount)), new Prisma.Decimal(0));

    // Net income (YTD): roll INCOME/EXPENSE into equity.
    const startOfYear = new Date(asOf);
    startOfYear.setMonth(0, 1);
    startOfYear.setHours(0, 0, 0, 0);
    const incomeFrom = from ?? startOfYear;

    const groupedIS = await prisma.journalLine.groupBy({
      by: ["accountId"],
      where: {
        companyId,
        entry: { status: "POSTED", entryDate: { gte: incomeFrom, lte: asOf } }
      } as any,
      _sum: { debit: true, credit: true }
    });
    const isIds = groupedIS.map((g) => g.accountId);
    const isAccounts = await prisma.accountingAccount.findMany({
      where: { companyId, id: { in: isIds } } as any
    });
    const isById = new Map(isAccounts.map((a: any) => [a.id, a]));
    const isRows = groupedIS
      .map((g) => {
        const a: any = isById.get(g.accountId);
        const type = String(a?.type ?? "");
        if (!["INCOME", "EXPENSE"].includes(type)) return null;
        const amount = balanceFor(a, g._sum?.debit, g._sum?.credit);
        return { type, amount };
      })
      .filter(Boolean) as any[];

    const incomeTotal = isRows
      .filter((r) => r.type === "INCOME")
      .reduce((acc, r) => acc.add(new Prisma.Decimal(r.amount)), new Prisma.Decimal(0));
    const expenseTotal = isRows
      .filter((r) => r.type === "EXPENSE")
      .reduce((acc, r) => acc.add(new Prisma.Decimal(r.amount)), new Prisma.Decimal(0));
    const netIncome = incomeTotal.sub(expenseTotal);

    const equity = [
      ...equityBase,
      {
        accountCode: "",
        accountName: "Net Income (YTD)",
        accountType: "EQUITY",
        normalBalance: "CREDIT",
        amount: netIncome
      }
    ];

    const totals = {
      assets: sum(assets),
      liabilities: sum(liabilities),
      equity: sum(equity)
    };
    const totalLE = totals.liabilities.add(totals.equity);
    const difference = totals.assets.sub(totalLE);

    res.json(
      serialize({
        asOf,
        netIncomeFrom: incomeFrom,
        assets,
        liabilities,
        equity,
        totals,
        totalLiabilitiesAndEquity: totalLE,
        difference
      })
    );
  } catch (e) {
    next(e);
  }
});

/** Finance & portfolio: Contracts register */
reportsRouter.get("/reports/finance-portfolio/contracts-register", async (req, res, next) => {
  try {
    const companyId = tenantCompanyIdOrThrow();
    const from = parseDateQ(req.query.from);
    const to = parseDateQ(req.query.to);
    const status = parseStringQ(req.query.status);
    const campaignId = parseStringQ(req.query.campaignId);
    const agentId = parseStringQ(req.query.agentId);
    const buyerId = parseStringQ(req.query.buyerId);
    const q = parseStringQ(req.query.q);

    const and: any[] = [{ companyId }];
    if (from) and.push({ createdAt: { gte: from } });
    if (to) and.push({ createdAt: { lte: to } });
    if (status) and.push({ status });
    if (campaignId) and.push({ campaignId });
    if (agentId) and.push({ agentId });
    if (buyerId) and.push({ buyerId });
    if (q) and.push({ contractNumber: { contains: q, mode: "insensitive" } });

    const rows = await prisma.contract.findMany({
      where: { AND: and } as any,
      include: { buyer: true, agent: true, campaign: true },
      orderBy: { createdAt: "desc" }
    });
    res.json(
      serialize(
        rows.map((c: any) => ({
          id: c.id,
          createdAt: c.createdAt,
          contractNumber: c.contractNumber,
          status: c.status,
          buyer: c.buyer?.displayName ?? null,
          agent: c.agent?.displayName ?? null,
          campaign: c.campaign?.name ?? null,
          principalAmount: c.principalAmount,
          profitRate: c.interestRateApr,
          tenureMonths: c.tenureMonths,
          createdByName: c.createdByName ?? null
        }))
      )
    );
  } catch (e) {
    next(e);
  }
});

/** Finance & portfolio: Upcoming EMIs */
reportsRouter.get("/reports/finance-portfolio/upcoming-emis", async (req, res, next) => {
  try {
    const companyId = tenantCompanyIdOrThrow();
    const from = parseDateQ(req.query.from);
    const to = parseDateQ(req.query.to);
    const status = parseStringQ(req.query.status);
    const and: any[] = [{ companyId }];
    if (from) and.push({ dueDate: { gte: from } });
    if (to) and.push({ dueDate: { lte: to } });
    if (status) and.push({ status });

    const rows = await prisma.installment.findMany({
      where: { AND: and } as any,
      include: { contract: { include: { buyer: true, agent: true } } },
      orderBy: [{ dueDate: "asc" }, { sequence: "asc" }]
    });
    res.json(
      serialize(
        rows.map((i: any) => ({
          id: i.id,
          dueDate: i.dueDate,
          sequence: i.sequence,
          status: i.status,
          totalDue: i.totalDue,
          paidAmount: i.paidAmount,
          outstanding: new Prisma.Decimal(i.totalDue).sub(new Prisma.Decimal(i.paidAmount)),
          contractNumber: i.contract?.contractNumber ?? null,
          buyer: i.contract?.buyer?.displayName ?? null,
          agent: i.contract?.agent?.displayName ?? null
        }))
      )
    );
  } catch (e) {
    next(e);
  }
});

/** Collections: Overdue aging */
reportsRouter.get("/reports/collections/overdue-aging", async (req, res, next) => {
  try {
    const companyId = tenantCompanyIdOrThrow();
    const asOf = parseDateQ(req.query.asOf) ?? new Date();
    const rows = await prisma.installment.findMany({
      where: { companyId, dueDate: { lte: asOf }, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] as any } } as any,
      include: { contract: { include: { buyer: true, agent: true } } },
      orderBy: [{ dueDate: "asc" }, { sequence: "asc" }]
    });

    const bucket = (days: number) => (days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+");
    res.json(
      serialize(
        rows.map((i: any) => {
          const due = new Date(i.dueDate);
          const days = Math.max(0, Math.floor((asOf.getTime() - due.getTime()) / (24 * 3600 * 1000)));
          const outstanding = new Prisma.Decimal(i.totalDue).sub(new Prisma.Decimal(i.paidAmount));
          return {
            id: i.id,
            contractNumber: i.contract?.contractNumber ?? null,
            buyer: i.contract?.buyer?.displayName ?? null,
            agent: i.contract?.agent?.displayName ?? null,
            dueDate: i.dueDate,
            daysOverdue: days,
            bucket: bucket(days),
            outstanding
          };
        })
      )
    );
  } catch (e) {
    next(e);
  }
});

/** Audit: Audit log */
reportsRouter.get("/reports/audit/audit-log", async (req, res, next) => {
  try {
    const companyId = tenantCompanyIdOrThrow();
    const from = parseDateQ(req.query.from);
    const to = parseDateQ(req.query.to);
    const and: any[] = [{ companyId }];
    if (from) and.push({ createdAt: { gte: from } });
    if (to) and.push({ createdAt: { lte: to } });
    const rows = await prisma.auditLog.findMany({
      where: { AND: and } as any,
      orderBy: { createdAt: "desc" },
      take: 500
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

/** Customer statements: Customer ledger summary */
reportsRouter.get("/reports/customer-statements/customer-ledger", async (req, res, next) => {
  try {
    const companyId = tenantCompanyIdOrThrow();
    const buyerId = parseStringQ(req.query.buyerId);
    const contractId = parseStringQ(req.query.contractId);
    const q = parseStringQ(req.query.q);
    const and: any[] = [{ companyId }];
    if (buyerId) and.push({ buyerId });
    if (contractId) and.push({ id: contractId });
    if (q) {
      and.push({
        OR: [
          { contractNumber: { contains: q, mode: "insensitive" } },
          { buyer: { displayName: { contains: q, mode: "insensitive" } } }
        ]
      });
    }

    const rows = await prisma.contract.findMany({
      where: { AND: and } as any,
      include: { buyer: true, installments: true, receipts: true },
      orderBy: { createdAt: "desc" }
    });

    res.json(
      serialize(
        rows.map((c: any) => {
          const totalDue = c.installments.reduce(
            (acc: Prisma.Decimal, i: any) => acc.add(new Prisma.Decimal(i.totalDue)),
            new Prisma.Decimal(0)
          );
          const totalPaid = c.installments.reduce(
            (acc: Prisma.Decimal, i: any) => acc.add(new Prisma.Decimal(i.paidAmount)),
            new Prisma.Decimal(0)
          );
          return {
            id: c.id,
            contractNumber: c.contractNumber,
            buyer: c.buyer?.displayName ?? null,
            principalAmount: c.principalAmount,
            totalDue,
            totalPaid,
            outstanding: totalDue.sub(totalPaid),
            receiptsCount: c.receipts?.length ?? 0
          };
        })
      )
    );
  } catch (e) {
    next(e);
  }
});

/** Operational: Vehicle inventory */
reportsRouter.get("/reports/operational/vehicle-inventory", async (req, res, next) => {
  try {
    const companyId = tenantCompanyIdOrThrow();
    const from = parseDateQ(req.query.from);
    const to = parseDateQ(req.query.to);
    const status = parseStringQ(req.query.status);
    const q = parseStringQ(req.query.q);
    const and: any[] = [{ companyId }];
    if (from) and.push({ createdAt: { gte: from } });
    if (to) and.push({ createdAt: { lte: to } });
    if (status) and.push({ status });
    if (q) {
      and.push({
        OR: [
          { registrationNo: { contains: q, mode: "insensitive" } },
          { make: { contains: q, mode: "insensitive" } },
          { model: { contains: q, mode: "insensitive" } },
          { color: { contains: q, mode: "insensitive" } }
        ]
      });
    }

    const rows = await prisma.vehicle.findMany({
      where: { AND: and } as any,
      orderBy: { createdAt: "desc" }
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

/** Operational: Task queue register */
reportsRouter.get("/reports/operational/task-queue", async (req, res, next) => {
  try {
    const companyId = tenantCompanyIdOrThrow();
    const from = parseDateQ(req.query.from);
    const to = parseDateQ(req.query.to);
    const status = parseStringQ(req.query.status);
    const type = parseStringQ(req.query.type);
    const q = parseStringQ(req.query.q);
    const and: any[] = [{ companyId }];
    if (from) and.push({ createdAt: { gte: from } });
    if (to) and.push({ createdAt: { lte: to } });
    if (status) and.push({ status });
    if (type) and.push({ type });
    if (q) {
      and.push({
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { contract: { contractNumber: { contains: q, mode: "insensitive" } } }
        ]
      });
    }

    const rows = await prisma.taskQueueRequest.findMany({
      where: { AND: and } as any,
      include: { contract: true, assignedTo: true },
      orderBy: { createdAt: "desc" },
      take: 500
    });
    res.json(
      serialize(
        rows.map((r: any) => ({
          id: r.id,
          createdAt: r.createdAt,
          type: r.requestType,
          status: r.status,
          contractNumber: r.contract?.contractNumber ?? null,
          requestedBy: r.createdByName ?? null,
          reviewedBy: r.updatedByName ?? null,
          reviewedAt: r.updatedAt ?? null,
          assignedTo: r.assignedTo?.name ?? null
        }))
      )
    );
  } catch (e) {
    next(e);
  }
});
