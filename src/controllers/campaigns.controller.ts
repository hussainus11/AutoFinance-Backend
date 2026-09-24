import { randomUUID } from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { tenantConnectOrThrow } from "../services/tenant-helpers.js";
import { notifyAdminUsers } from "../services/notifications.js";

export const campaignsRouter = Router();

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

const campaignFields = z.object({
    name: z.string().min(1),
    code: z.string().optional().nullable(),
    validateCampaign: z.boolean().optional().default(false),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    isActive: z.boolean().optional().default(true),
    notes: z.string().optional().nullable(),

    allowChartOverride: z.boolean().optional().default(false),
    allowInstallmentRestructure: z.boolean().optional().default(false),
    allowBackdatedContracts: z.boolean().optional().default(false),

    tenureMonthsOptions: z.array(z.number().int().positive()).optional().default([]),
    vehicleIds: z.array(z.string().uuid()).optional().default([]),
    chartIds: z.array(z.string().uuid()).optional().default([])
  });

const campaignCreate = campaignFields.refine(
  (d) => (d.validateCampaign ? d.endDate.getTime() >= d.startDate.getTime() : true),
  { message: "endDate must be on or after startDate" }
);
const campaignUpdate = campaignFields.partial();

const include = {
  vehicles: {
    include: { vehicle: { include: { images: { orderBy: { sortOrder: "asc" as const } } } } }
  },
  charts: { include: { chart: true } }
} as const;

function buildCampaignSearchWhere(q: string): Prisma.CampaignWhereInput {
  const trimmed = q.trim();
  return {
    OR: [
      { name: { contains: trimmed, mode: "insensitive" } },
      { code: { contains: trimmed, mode: "insensitive" } },
      { notes: { contains: trimmed, mode: "insensitive" } }
    ]
  };
}

campaignsRouter.get("/campaigns", async (req, res, next) => {
  try {
    const activeOnly = req.query.active === "true";
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const parts: Prisma.CampaignWhereInput[] = [];
    if (activeOnly) parts.push({ isActive: true });
    if (q) parts.push(buildCampaignSearchWhere(q));
    const where =
      parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : { AND: parts };
    const rows = await (prisma as any).campaign.findMany({
      where,
      include,
      orderBy: [{ isActive: "desc" }, { startDate: "desc" }, { createdAt: "desc" }]
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

campaignsRouter.get("/campaigns/:id", async (req, res, next) => {
  try {
    const row = await (prisma as any).campaign.findUnique({ where: { id: req.params.id }, include });
    if (!row) return res.status(404).json({ error: "Campaign not found" });
    res.json(serialize(row));
  } catch (e) {
    next(e);
  }
});

campaignsRouter.post("/campaigns", async (req, res, next) => {
  try {
    const body = campaignCreate.parse(req.body);
    const tenant = tenantConnectOrThrow();

    const row = await (prisma as any).campaign.create({
      data: {
        name: body.name,
        code: body.code ?? undefined,
        validateCampaign: body.validateCampaign ?? false,
        startDate: body.startDate,
        endDate: body.endDate,
        isActive: body.isActive ?? true,
        notes: body.notes ?? undefined,
        allowChartOverride: body.allowChartOverride ?? false,
        allowInstallmentRestructure: body.allowInstallmentRestructure ?? false,
        allowBackdatedContracts: body.allowBackdatedContracts ?? false,
        tenureMonthsOptions: body.tenureMonthsOptions ?? [],
        ...tenant,
        vehicles: body.vehicleIds.length
          ? {
              create: body.vehicleIds.map((vehicleId: string) => ({
                id: randomUUID(),
                vehicle: { connect: { id: vehicleId } },
                ...tenant
              }))
            }
          : undefined,
        charts: body.chartIds.length
          ? {
              create: body.chartIds.map((chartId: string) => ({
                id: randomUUID(),
                chart: { connect: { id: chartId } },
                ...tenant
              }))
            }
          : undefined
      },
      include
    });

    await notifyAdminUsers({
      type: "CAMPAIGN_CREATED",
      title: "Campaign added",
      message: row.name,
      href: "/dashboard/autofinance/campaigns"
    });
    res.status(201).json(serialize(row));
  } catch (e) {
    next(e);
  }
});

campaignsRouter.patch("/campaigns/:id", async (req, res, next) => {
  try {
    const id = req.params.id;
    const body = campaignUpdate.parse(req.body);
    const tenant = tenantConnectOrThrow();

    const row = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.campaign.findUnique({ where: { id } });
      if (!existing) return null;

      const nextValidate = body.validateCampaign ?? existing.validateCampaign ?? true;
      const nextStart = body.startDate ?? existing.startDate;
      const nextEnd = body.endDate ?? existing.endDate;
      if (nextValidate && nextEnd.getTime() < nextStart.getTime()) {
        throw new Error("endDate must be on or after startDate");
      }

      const data: Record<string, unknown> = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.code !== undefined) data.code = body.code;
      if (body.validateCampaign !== undefined) data.validateCampaign = body.validateCampaign;
      if (body.startDate !== undefined) data.startDate = body.startDate;
      if (body.endDate !== undefined) data.endDate = body.endDate;
      if (body.isActive !== undefined) data.isActive = body.isActive;
      if (body.notes !== undefined) data.notes = body.notes;
      if (body.allowChartOverride !== undefined) data.allowChartOverride = body.allowChartOverride;
      if (body.allowInstallmentRestructure !== undefined)
        data.allowInstallmentRestructure = body.allowInstallmentRestructure;
      if (body.allowBackdatedContracts !== undefined)
        data.allowBackdatedContracts = body.allowBackdatedContracts;
      if (body.tenureMonthsOptions !== undefined)
        data.tenureMonthsOptions = body.tenureMonthsOptions;

      if (Object.keys(data).length) {
        await tx.campaign.update({ where: { id }, data: data as never });
      }

      if (body.vehicleIds !== undefined) {
        await tx.campaignVehicle.deleteMany({ where: { campaignId: id } });
        if (body.vehicleIds.length) {
          for (const vehicleId of body.vehicleIds) {
            await tx.campaignVehicle.create({
              data: {
                id: randomUUID(),
                campaign: { connect: { id } },
                vehicle: { connect: { id: vehicleId } },
                ...tenant
              }
            });
          }
        }
      }

      if (body.chartIds !== undefined) {
        await tx.campaignChart.deleteMany({ where: { campaignId: id } });
        if (body.chartIds.length) {
          for (const chartId of body.chartIds) {
            await tx.campaignChart.create({
              data: {
                id: randomUUID(),
                campaign: { connect: { id } },
                chart: { connect: { id: chartId } },
                ...tenant
              }
            });
          }
        }
      }

      return tx.campaign.findUniqueOrThrow({ where: { id }, include });
    });

    if (!row) return res.status(404).json({ error: "Campaign not found" });
    await notifyAdminUsers({
      type: "CAMPAIGN_UPDATED",
      title: "Campaign updated",
      message: row.name,
      href: "/dashboard/autofinance/campaigns"
    });
    res.json(serialize(row));
  } catch (e) {
    if (e instanceof Error && e.message === "endDate must be on or after startDate") {
      res.status(400).json({ error: e.message });
      return;
    }
    next(e);
  }
});

campaignsRouter.delete("/campaigns/:id", async (req, res, next) => {
  try {
    await (prisma as any).campaign.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

