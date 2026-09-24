import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { postExpenseJournalEntry } from "../services/accounting-posting.js";
import { notifyAdminUsers } from "../services/notifications.js";

export const expensesRouter = Router();

const categoryCreate = z.object({
  name: z.string().min(1),
  isActive: z.boolean().optional()
});

const expenseCreate = z.object({
  expenseDate: z.string().datetime().optional(),
  amount: z.string().or(z.number()),
  description: z.string().min(1),
  notes: z.string().optional().nullable(),
  vendor: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  paymentMode: z.string().optional().nullable(),
  categoryId: z.string().uuid().optional().nullable()
});

/** Expenses — Categories CRUD. */
expensesRouter.get("/expense-categories", async (_req, res, next) => {
  try {
    const rows = await (prisma as any).expenseCategory.findMany({ orderBy: { name: "asc" } });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

expensesRouter.post("/expense-categories", async (req, res, next) => {
  try {
    const body = categoryCreate.parse(req.body);
    const row = await (prisma as any).expenseCategory.create({
      data: { name: body.name.trim(), isActive: body.isActive ?? true }
    });
    res.status(201).json(serialize(row));
  } catch (e) {
    next(e);
  }
});

expensesRouter.patch("/expense-categories/:id", async (req, res, next) => {
  try {
    const body = categoryCreate.partial().parse(req.body);
    const row = await (prisma as any).expenseCategory.update({
      where: { id: req.params.id },
      data: {
        name: body.name ? body.name.trim() : undefined,
        isActive: typeof body.isActive === "boolean" ? body.isActive : undefined
      }
    });
    res.json(serialize(row));
  } catch (e) {
    next(e);
  }
});

expensesRouter.delete("/expense-categories/:id", async (req, res, next) => {
  try {
    await (prisma as any).expenseCategory.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** Expenses — list/create/update/delete with basic filters. */
expensesRouter.get("/expenses", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const from = typeof req.query.from === "string" ? req.query.from.trim() : "";
    const to = typeof req.query.to === "string" ? req.query.to.trim() : "";
    const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId.trim() : "";

    const and: any[] = [];
    if (q) {
      and.push({
        OR: [
          { description: { contains: q, mode: "insensitive" } },
          { vendor: { contains: q, mode: "insensitive" } },
          { reference: { contains: q, mode: "insensitive" } }
        ]
      });
    }
    if (categoryId) and.push({ categoryId });
    if (from) and.push({ expenseDate: { gte: new Date(from) } });
    if (to) and.push({ expenseDate: { lte: new Date(to) } });

    const rows = await (prisma as any).expense.findMany({
      where: and.length ? { AND: and } : undefined,
      include: { category: true },
      orderBy: { expenseDate: "desc" }
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

expensesRouter.post("/expenses", async (req, res, next) => {
  try {
    const body = expenseCreate.parse(req.body);
    const row = await (prisma as any).expense.create({
      data: {
        expenseDate: body.expenseDate ? new Date(body.expenseDate) : undefined,
        amount: new Prisma.Decimal(String(body.amount)),
        description: body.description.trim(),
        notes: body.notes ?? undefined,
        vendor: body.vendor ?? undefined,
        reference: body.reference ?? undefined,
        paymentMode: body.paymentMode ?? undefined,
        category: body.categoryId ? { connect: { id: body.categoryId } } : undefined
      },
      include: { category: true }
    });
    try {
      await postExpenseJournalEntry(row.id);
    } catch {
      // Accounting optional until configured
    }
    await notifyAdminUsers({
      type: "EXPENSE_CREATED",
      title: "Expense added",
      message: row.description,
      href: "/dashboard/autofinance/expenses"
    });
    res.status(201).json(serialize(row));
  } catch (e) {
    next(e);
  }
});

expensesRouter.patch("/expenses/:id", async (req, res, next) => {
  try {
    const body = expenseCreate.partial().parse(req.body);
    const row = await (prisma as any).expense.update({
      where: { id: req.params.id },
      data: {
        expenseDate: body.expenseDate ? new Date(body.expenseDate) : undefined,
        amount: body.amount != null ? new Prisma.Decimal(String(body.amount)) : undefined,
        description: body.description ? body.description.trim() : undefined,
        notes: body.notes ?? undefined,
        vendor: body.vendor ?? undefined,
        reference: body.reference ?? undefined,
        paymentMode: body.paymentMode ?? undefined,
        ...(body.categoryId !== undefined
          ? { category: body.categoryId ? { connect: { id: body.categoryId } } : { disconnect: true } }
          : {})
      },
      include: { category: true }
    });
    await notifyAdminUsers({
      type: "EXPENSE_UPDATED",
      title: "Expense updated",
      message: row.description,
      href: "/dashboard/autofinance/expenses"
    });
    res.json(serialize(row));
  } catch (e) {
    next(e);
  }
});

expensesRouter.delete("/expenses/:id", async (req, res, next) => {
  try {
    await (prisma as any).expense.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

