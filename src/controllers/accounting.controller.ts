import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { ensureDefaultAccounting } from "../services/accounting-defaults.js";
import { getRequestContext } from "../context.js";

export const accountingRouter = Router();

const accountCreate = z
  .object({
    code: z.string().optional().nullable(),
    name: z.string().min(1),
    nameUr: z.string().optional().nullable(),
    type: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]),
    normalBalance: z.enum(["DEBIT", "CREDIT"]),
    isActive: z.boolean().optional()
  })
  .strict();

const accountUpdate = accountCreate.partial().strict();

accountingRouter.get("/accounting/accounts", async (_req, res, next) => {
  try {
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId ?? null;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });
    await ensureDefaultAccounting(prisma as any, { companyId, branchId });
    const rows = await prisma.accountingAccount.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }]
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

accountingRouter.post("/accounting/accounts", async (req, res, next) => {
  try {
    const body = accountCreate.parse(req.body);
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId ?? null;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });
    const row = await prisma.accountingAccount.create({
      data: {
        company: { connect: { id: companyId } },
        ...(branchId ? { branch: { connect: { id: branchId } } } : {}),
        code: body.code?.trim() || undefined,
        name: body.name.trim(),
        nameUr: body.nameUr != null ? body.nameUr.trim() || null : undefined,
        type: body.type,
        normalBalance: body.normalBalance,
        isActive: body.isActive ?? true
      } as any
    });
    res.status(201).json(serialize(row));
  } catch (e) {
    next(e);
  }
});

accountingRouter.patch("/accounting/accounts/:id", async (req, res, next) => {
  try {
    const body = accountUpdate.parse(req.body);
    const row = await prisma.accountingAccount.update({
      where: { id: req.params.id },
      data: {
        ...(body.code !== undefined ? { code: body.code?.trim() || null } : {}),
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.nameUr !== undefined ? { nameUr: body.nameUr != null ? body.nameUr.trim() || null : null } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.normalBalance !== undefined ? { normalBalance: body.normalBalance } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {})
      } as any
    });
    res.json(serialize(row));
  } catch (e) {
    next(e);
  }
});

accountingRouter.get("/accounting/bank-accounts", async (_req, res, next) => {
  try {
    const rows = await prisma.accountingBankAccount.findMany({
      include: { account: true },
      orderBy: { name: "asc" }
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

const bankAccountCreate = z
  .object({
    name: z.string().min(1),
    accountId: z.string().uuid(),
    isActive: z.boolean().optional()
  })
  .strict();

accountingRouter.post("/accounting/bank-accounts", async (req, res, next) => {
  try {
    const body = bankAccountCreate.parse(req.body);
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId ?? null;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });
    const account = await prisma.accountingAccount.findUnique({ where: { id: body.accountId } });
    if (!account) return res.status(400).json({ error: "Account not found" });
    if (account.type !== "ASSET") return res.status(400).json({ error: "Bank account must map to an ASSET account" });

    const row = await prisma.accountingBankAccount.create({
      data: {
        company: { connect: { id: companyId } },
        ...(branchId ? { branch: { connect: { id: branchId } } } : {}),
        name: body.name.trim(),
        isActive: body.isActive ?? true,
        account: { connect: { id: body.accountId } }
      } as any,
      include: { account: true }
    });
    res.status(201).json(serialize(row));
  } catch (e) {
    next(e);
  }
});

const postingConfigPut = z
  .object({
    loanReceivableAccountId: z.string().uuid(),
    interestIncomeAccountId: z.string().uuid(),
    expenseDefaultAccountId: z.string().uuid(),
    commissionExpenseAccountId: z.string().uuid(),
    commissionPayableAccountId: z.string().uuid()
  })
  .strict();

accountingRouter.get("/accounting/posting-config", async (_req, res, next) => {
  try {
    const row = await prisma.accountingPostingConfig.findFirst({
      include: {
        loanReceivableAccount: true,
        interestIncomeAccount: true,
        expenseDefaultAccount: true,
        commissionExpenseAccount: true,
        commissionPayableAccount: true
      } as any
    });
    res.json(serialize(row));
  } catch (e) {
    next(e);
  }
});

accountingRouter.put("/accounting/posting-config", async (req, res, next) => {
  try {
    const body = postingConfigPut.parse(req.body);
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId ?? null;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });

    const row = await prisma.accountingPostingConfig.upsert({
      where: { companyId } as any,
      create: {
        company: { connect: { id: companyId } },
        ...(branchId ? { branch: { connect: { id: branchId } } } : {}),
        loanReceivableAccount: { connect: { id: body.loanReceivableAccountId } },
        interestIncomeAccount: { connect: { id: body.interestIncomeAccountId } },
        expenseDefaultAccount: { connect: { id: body.expenseDefaultAccountId } },
        commissionExpenseAccount: { connect: { id: body.commissionExpenseAccountId } },
        commissionPayableAccount: { connect: { id: body.commissionPayableAccountId } }
      } as any,
      update: {
        loanReceivableAccount: { connect: { id: body.loanReceivableAccountId } },
        interestIncomeAccount: { connect: { id: body.interestIncomeAccountId } },
        expenseDefaultAccount: { connect: { id: body.expenseDefaultAccountId } },
        commissionExpenseAccount: { connect: { id: body.commissionExpenseAccountId } },
        commissionPayableAccount: { connect: { id: body.commissionPayableAccountId } }
      } as any,
      include: {
        loanReceivableAccount: true,
        interestIncomeAccount: true,
        expenseDefaultAccount: true,
        commissionExpenseAccount: true,
        commissionPayableAccount: true
      } as any
    });

    res.json(serialize(row));
  } catch (e) {
    next(e);
  }
});

accountingRouter.get("/accounting/journal-entries", async (req, res, next) => {
  try {
    const from = typeof req.query.from === "string" ? req.query.from.trim() : "";
    const to = typeof req.query.to === "string" ? req.query.to.trim() : "";
    const where: any = {};
    if (from) where.entryDate = { ...(where.entryDate ?? {}), gte: new Date(from) };
    if (to) where.entryDate = { ...(where.entryDate ?? {}), lte: new Date(to) };

    const rows = await prisma.journalEntry.findMany({
      where,
      include: { lines: { include: { account: true } } },
      orderBy: { entryDate: "desc" },
      take: 200
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

const manualJournalCreate = z
  .object({
    entryDate: z.string().datetime().optional(),
    memo: z.string().optional().nullable(),
    lines: z
      .array(
        z.object({
          accountId: z.string().uuid(),
          debit: z.string().or(z.number()).optional().default(0),
          credit: z.string().or(z.number()).optional().default(0),
          note: z.string().optional().nullable()
        })
      )
      .min(2)
  })
  .strict();

accountingRouter.post("/accounting/journal-entries", async (req, res, next) => {
  try {
    const body = manualJournalCreate.parse(req.body);
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId ?? null;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });

    const entryDate = body.entryDate ? new Date(body.entryDate) : new Date();

    const lines = body.lines.map((l) => ({
      accountId: l.accountId,
      debit: new Prisma.Decimal(String(l.debit ?? 0)),
      credit: new Prisma.Decimal(String(l.credit ?? 0)),
      note: l.note ?? undefined
    }));

    const debitSum = lines.reduce((s, l) => s.add(l.debit), new Prisma.Decimal(0));
    const creditSum = lines.reduce((s, l) => s.add(l.credit), new Prisma.Decimal(0));
    if (!debitSum.eq(creditSum)) {
      return res.status(400).json({ error: "Journal entry must balance (total debit equals total credit)." });
    }

    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.journalEntry.create({
        data: {
          entryDate,
          memo: body.memo ?? undefined,
          status: "POSTED",
          sourceType: "MANUAL",
          company: { connect: { id: companyId } },
          ...(branchId ? { branch: { connect: { id: branchId } } } : {})
        } as any
      });
      await tx.journalLine.createMany({
        data: lines.map((l) => ({
          entryId: created.id,
          companyId,
          branchId: branchId ?? null,
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
          note: l.note
        })) as any
      });
      return tx.journalEntry.findUnique({
        where: { id: created.id },
        include: { lines: { include: { account: true } } }
      });
    });

    res.status(201).json(serialize(row));
  } catch (e) {
    next(e);
  }
});

