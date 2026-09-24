import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { notifyAdminUsers } from "../services/notifications.js";

export const chartsRouter = Router();

const chartTypeEnum = z.enum([
  "DOWN_PAYMENT_MIN",
  "INTEREST_RATE_APR",
  "BALLOON_CHART",
  "COMMISSION_CHART",
  "ORIGINATION_FEE",
  "DOCUMENTATION_FEE",
  "REGISTRATION_FEE",
  "PROCESSING_FEE",
  "TITLE_FEE",
  "LATE_PAYMENT_FEE",
  "PREPAYMENT_PENALTY",
  "GAP_INSURANCE",
  "EXTENDED_WARRANTY",
  "DEALERSHIP_ADMIN_FEE",
  "CREDIT_INSURANCE",
  "OTHER"
]);

const chartFields = z.object({
  chartType: chartTypeEnum,
  label: z.string().optional().nullable(),
  validateChart: z.boolean().optional().default(false),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  valueKind: z.enum(["FIXED", "PERCENTAGE"]),
  value: z.union([z.string(), z.number()]),
  priority: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
  notes: z.string().optional().nullable()
});

const chartCreate = chartFields
  .refine(
    (d) => (d.validateChart ? d.endDate.getTime() >= d.startDate.getTime() : true),
    { message: "endDate must be on or after startDate" }
  )
  .refine(
    (d) => {
      if (d.valueKind !== "PERCENTAGE") return true;
      const n = Number(d.value);
      return Number.isFinite(n) && n >= 0 && n <= 100;
    },
    {
      message: "Percentage value must be between 0 and 100"
    }
  );

const chartUpdate = chartFields.partial();

const CHART_TYPE_VALUES = chartTypeEnum.options;

function buildChartSearchWhere(q: string): Prisma.FinanceChartWhereInput {
  const trimmed = q.trim();
  const matchingTypes = CHART_TYPE_VALUES.filter(
    (t) =>
      t.toLowerCase().includes(trimmed.toLowerCase()) ||
      t.replace(/_/g, " ").toLowerCase().includes(trimmed.toLowerCase())
  );
  const or: Prisma.FinanceChartWhereInput[] = [
    { label: { contains: trimmed, mode: "insensitive" } },
    { notes: { contains: trimmed, mode: "insensitive" } }
  ];
  if (matchingTypes.length > 0) {
    or.push({ chartType: { in: matchingTypes } });
  }
  return { OR: or };
}

/** Finance chart rules — time-bound fees and rates for contract calculations. */
chartsRouter.get("/charts", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const rows = await (prisma as any).financeChart.findMany({
      where: q ? buildChartSearchWhere(q) : undefined,
      orderBy: [{ chartType: "asc" }, { startDate: "desc" }, { priority: "desc" }]
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

chartsRouter.get("/charts/:id", async (req, res, next) => {
  try {
    const row = await (prisma as any).financeChart.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: "Chart not found" });
    res.json(serialize(row));
  } catch (e) {
    next(e);
  }
});

chartsRouter.post("/charts", async (req, res, next) => {
  try {
    const body = chartCreate.parse(req.body);
    const row = await (prisma as any).financeChart.create({
      data: {
        chartType: body.chartType,
        label: body.label ?? undefined,
        validateChart: body.validateChart ?? false,
        startDate: body.startDate,
        endDate: body.endDate,
        valueKind: body.valueKind,
        value: new Prisma.Decimal(String(body.value)),
        priority: body.priority ?? 0,
        isActive: body.isActive ?? true,
        notes: body.notes ?? undefined
      }
    });
    await notifyAdminUsers({
      type: "CHART_CREATED",
      title: "Chart added",
      message: `${row.chartType}${row.label ? ` — ${row.label}` : ""}`,
      href: "/dashboard/autofinance/charts"
    });
    res.status(201).json(serialize(row));
  } catch (e) {
    next(e);
  }
});

chartsRouter.patch("/charts/:id", async (req, res, next) => {
  try {
    const id = req.params.id;
    const body = chartUpdate.parse(req.body);
    const existing = await (prisma as any).financeChart.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Chart not found" });

    const nextValidate = body.validateChart ?? existing.validateChart ?? true;
    const nextStart = body.startDate ?? existing.startDate;
    const nextEnd = body.endDate ?? existing.endDate;
    if (nextValidate && nextEnd.getTime() < nextStart.getTime()) {
      return res.status(400).json({ error: "endDate must be on or after startDate" });
    }

    const nextKind = body.valueKind ?? existing.valueKind;
    const nextValueRaw = body.value ?? existing.value;
    if (nextKind === "PERCENTAGE") {
      const n = Number(nextValueRaw);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return res.status(400).json({ error: "Percentage value must be between 0 and 100" });
      }
    }

    const data: Record<string, unknown> = {};
    if (body.chartType !== undefined) data.chartType = body.chartType;
    if (body.label !== undefined) data.label = body.label;
    if (body.validateChart !== undefined) data.validateChart = body.validateChart;
    if (body.startDate !== undefined) data.startDate = body.startDate;
    if (body.endDate !== undefined) data.endDate = body.endDate;
    if (body.valueKind !== undefined) data.valueKind = body.valueKind;
    if (body.value !== undefined) data.value = new Prisma.Decimal(String(body.value));
    if (body.priority !== undefined) data.priority = body.priority;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.notes !== undefined) data.notes = body.notes;

    const row = await (prisma as any).financeChart.update({
      where: { id },
      data: data as never
    });
    await notifyAdminUsers({
      type: "CHART_UPDATED",
      title: "Chart updated",
      message: `${row.chartType}${row.label ? ` — ${row.label}` : ""}`,
      href: "/dashboard/autofinance/charts"
    });
    res.json(serialize(row));
  } catch (e) {
    next(e);
  }
});

chartsRouter.delete("/charts/:id", async (req, res, next) => {
  try {
    await (prisma as any).financeChart.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      res.status(404).json({ error: "Chart not found" });
      return;
    }
    next(e);
  }
});
