import { Router } from "express";
import { z } from "zod";
import { Prisma, type InstallmentType } from "@prisma/client";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { buildEmiSchedule } from "../services/emi.js";
import { getRequestContext } from "../context.js";

export const quotationsRouter = Router();

function ensureQuotationsAvailable(res: { status: (c: number) => any; json: (v: any) => any }): boolean {
  const p = prisma as unknown as { quotation?: unknown };
  if (typeof p.quotation === "undefined") {
    res.status(500).json({
      error:
        "Prisma client is out of date (quotation model missing). Stop the API, run `npx prisma generate`, apply migrations, then restart."
    });
    return false;
  }
  return true;
}

const installmentTypeEnum = z.enum(["MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "YEARLY"]);

const businessPartnerRow = z.object({
  partnerId: z.string().uuid(),
  role: z.enum(["BUYER", "AGENT", "GUARANTOR"])
});

const quotationCreate = z.object({
  quotationNumber: z.string().min(1),
  startDate: z.string().datetime(),
  campaignId: z.string().uuid().optional().nullable(),
  downPaymentAmount: z.union([z.string(), z.number()]).optional().nullable(),
  feesAmount: z.union([z.string(), z.number()]).optional().nullable(),
  principalAmount: z.string().or(z.number()),
  interestRateApr: z.string().or(z.number()),
  tenureMonths: z.number().int().positive(),
  installmentType: installmentTypeEnum.optional(),
  balloonAmount: z.string().or(z.number()).optional().nullable(),
  vehicleLinks: z
    .array(
      z.object({
        vehicleId: z.string().uuid(),
        salePrice: z.string().or(z.number())
      })
    )
    .min(1),
  businessPartners: z.array(businessPartnerRow).min(1)
});

const CFG_QUOTATION_PREFIX = "numbering.quotation.prefix";
const CFG_QUOTATION_NEXT = "numbering.quotation.next";
const CFG_QUOTATION_ALLOW_MANUAL = "numbering.quotation.allowManual";

function parseBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw !== "string") return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return fallback;
}

function pad4(n: number) {
  return String(n).padStart(4, "0");
}

async function nextNumberFromSystemConfig(tx: any, companyId: string, prefixKey: string, nextKey: string): Promise<string> {
  const prefixRows = (await tx.$queryRawUnsafe(
    `SELECT "value" FROM "SystemConfig" WHERE "companyId" = $1 AND "key" = $2 LIMIT 1`,
    companyId,
    prefixKey
  )) as Array<{ value: string }>;
  const prefixRaw = (prefixRows?.[0]?.value ?? "Q-").trim() || "Q-";
  const prefixMatch = prefixRaw.match(/^(.*?)(\d+)$/);
  const inferredPrefix = prefixMatch?.[1] ?? null;
  const inferredWidth = prefixMatch?.[2]?.length ?? 0;

  const nextRows = (await tx.$queryRawUnsafe(
    `SELECT "value" FROM "SystemConfig" WHERE "companyId" = $1 AND "key" = $2 FOR UPDATE`,
    companyId,
    nextKey
  )) as Array<{ value: string }>;
  const nextRaw = String(nextRows?.[0]?.value ?? "1").replace(/,/g, "").trim();
  const direct = Number(nextRaw);
  const trailingDigits = nextRaw.match(/(\d+)$/)?.[1] ?? "";
  const extracted = trailingDigits ? Number(trailingDigits) : Number.NaN;
  const current = Number.isFinite(direct) ? direct : extracted;
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
    nextKey,
    inferredPrefix && inferredWidth > 0
      ? `${inferredPrefix}${String(n + 1).padStart(inferredWidth, "0")}`
      : String(n + 1)
  );

  if (inferredPrefix && inferredWidth > 0) {
    return `${inferredPrefix}${String(n).padStart(inferredWidth, "0")}`;
  }
  return `${prefixRaw}${pad4(n)}`;
}

const quotationUpdate = quotationCreate.partial().extend({
  status: z.enum(["CREATED", "DRAFT", "ISSUED", "EXPIRED", "CONVERTED", "CANCELLED"]).optional()
});

const scheduleBody = z.object({
  startDate: z.string().datetime()
});

const convertBody = z
  .object({
    contractNumber: z.string().min(1),
    startDate: z.string().datetime().optional()
  })
  .strict();

function pickPartners(rows: Array<{ partnerId: string; role: "BUYER" | "AGENT" | "GUARANTOR" }>) {
  const buyer = rows.find((r) => r.role === "BUYER");
  const agent = rows.find((r) => r.role === "AGENT");
  const guarantors = rows.filter((r) => r.role === "GUARANTOR");
  if (!buyer) throw new Error("Quotation must include a BUYER");
  return { buyerId: buyer.partnerId, agentId: agent?.partnerId ?? null, guarantorIds: guarantors.map((g) => g.partnerId) };
}

const QUOTATION_STATUSES = new Set(["CREATED", "DRAFT", "ISSUED", "EXPIRED", "CONVERTED", "CANCELLED"]);

function buildQuotationSearchWhere(q: string): Prisma.QuotationWhereInput {
  const trimmed = q.trim();
  const or: Prisma.QuotationWhereInput[] = [
    { quotationNumber: { contains: trimmed, mode: "insensitive" } },
    { buyer: { displayName: { contains: trimmed, mode: "insensitive" } } },
    { agent: { displayName: { contains: trimmed, mode: "insensitive" } } },
    {
      vehicles: {
        some: {
          vehicle: {
            OR: [
              { registrationNumber: { contains: trimmed, mode: "insensitive" } },
              { vin: { contains: trimmed, mode: "insensitive" } },
              { stockNumber: { contains: trimmed, mode: "insensitive" } }
            ]
          }
        }
      }
    }
  ];
  const statusUpper = trimmed.toUpperCase();
  if (QUOTATION_STATUSES.has(statusUpper)) {
    or.push({ status: statusUpper as Prisma.EnumQuotationStatusFilter["equals"] });
  }
  return { OR: or };
}

/** Quotations — list/search */
quotationsRouter.get("/quotations", async (req, res, next) => {
  try {
    if (!ensureQuotationsAvailable(res)) return;
    const buyerId = typeof req.query.buyerId === "string" ? req.query.buyerId.trim() : "";
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const statusQ = typeof req.query.status === "string" ? req.query.status.trim().toUpperCase() : "";
    const parts: Prisma.QuotationWhereInput[] = [];
    if (buyerId) parts.push({ buyerId });
    if (q) parts.push(buildQuotationSearchWhere(q));
    if (statusQ && QUOTATION_STATUSES.has(statusQ)) parts.push({ status: statusQ as any });
    const where = parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : { AND: parts };

    const rows = await (prisma as any).quotation.findMany({
      where,
      include: {
        buyer: true,
        agent: true,
        vehicles: { include: { vehicle: true } },
        installments: { select: { id: true }, take: 1 }
      },
      orderBy: { createdAt: "desc" }
    });
    res.json(serialize(rows ?? []));
  } catch (e) {
    next(e);
  }
});

/** Quotations — view */
quotationsRouter.get("/quotations/:id", async (req, res, next) => {
  try {
    if (!ensureQuotationsAvailable(res)) return;
    const row = await (prisma as any).quotation.findUnique({
      where: { id: req.params.id },
      include: {
        buyer: true,
        agent: true,
        campaign: true,
        vehicles: { include: { vehicle: true } },
        guarantors: { include: { partner: true } },
        installments: { orderBy: [{ sequence: "asc" }, { dueDate: "asc" }] },
        convertedContract: { select: { id: true, contractNumber: true } }
      }
    });
    if (!row) return res.status(404).json({ error: "Quotation not found" });
    res.json(serialize(row));
  } catch (e) {
    next(e);
  }
});

/** Quotations — create */
quotationsRouter.post("/quotations", async (req, res, next) => {
  try {
    if (!ensureQuotationsAvailable(res)) return;
    const body = quotationCreate.parse(req.body);
    const filledPartners = body.businessPartners.filter((r) => r.partnerId.trim());
    const { buyerId, agentId, guarantorIds } = pickPartners(filledPartners as any);
    const startDate = new Date(body.startDate);
    const tenantCompanyId = getRequestContext()?.companyId ?? null;
    const tenantBranchId = getRequestContext()?.branchId ?? null;
    if (!tenantCompanyId) {
      res.status(400).json({ error: "Missing tenant companyId. Please login again." });
      return;
    }
    const tenant = {
      company: { connect: { id: tenantCompanyId } },
      ...(tenantBranchId ? { branch: { connect: { id: tenantBranchId } } } : {})
    } as const;

    const row = await prisma.$transaction(async (tx) => {
      // Auto numbering: if manual override is disabled, generate quotationNumber and bump counter.
      let quotationNumber = body.quotationNumber.trim();
      try {
        const allowRows = (await (tx as any).$queryRawUnsafe(
          `SELECT "value" FROM "SystemConfig" WHERE "companyId" = $1 AND "key" = $2 LIMIT 1`,
          tenantCompanyId,
          CFG_QUOTATION_ALLOW_MANUAL
        )) as Array<{ value: string }>;
        const allowManual = parseBool(allowRows?.[0]?.value, false);
        if (!allowManual) {
          quotationNumber = await nextNumberFromSystemConfig(tx, tenantCompanyId, CFG_QUOTATION_PREFIX, CFG_QUOTATION_NEXT);
        }
      } catch {
        // If SystemConfig isn't available yet, fall back to the provided number.
      }

      const baseData = {
        quotationNumber,
        buyer: { connect: { id: buyerId } },
        ...(agentId ? { agent: { connect: { id: agentId } } } : {}),
        ...(body.campaignId ? { campaign: { connect: { id: body.campaignId } } } : {}),
        downPaymentAmount:
          body.downPaymentAmount == null ? undefined : new Prisma.Decimal(String(body.downPaymentAmount)),
        feesAmount: body.feesAmount == null ? undefined : new Prisma.Decimal(String(body.feesAmount)),
        principalAmount: new Prisma.Decimal(String(body.principalAmount)),
        interestRateApr: new Prisma.Decimal(String(body.interestRateApr)),
        tenureMonths: body.tenureMonths,
        installmentType: (body.installmentType ?? "MONTHLY") as any,
        balloonAmount: body.balloonAmount == null ? undefined : new Prisma.Decimal(String(body.balloonAmount)),
        startDate,
        ...tenant
      } as const;

      let q: any;
      try {
        q = await (tx as any).quotation.create({
          data: { ...baseData, status: "CREATED" } as any
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // DB enum not migrated yet (CREATED missing) → retry with DRAFT for compatibility.
        if (msg.includes("Invalid value for argument `status`") || msg.includes("Expected QuotationStatus")) {
          q = await (tx as any).quotation.create({
            data: { ...baseData, status: "DRAFT" } as any
          });
        } else {
          throw e;
        }
      }

      for (const v of body.vehicleLinks) {
        await (tx as any).quotationVehicle.create({
          data: {
            quotation: { connect: { id: q.id } },
            vehicle: { connect: { id: v.vehicleId } },
            salePrice: new Prisma.Decimal(String(v.salePrice)),
            ...tenant
          } as any
        });
      }

      for (const gid of guarantorIds) {
        await (tx as any).quotationGuarantor.create({
          data: {
            quotation: { connect: { id: q.id } },
            partner: { connect: { id: gid } },
            ...tenant
          } as any
        });
      }

      // Persist installment snapshot immediately for quotations.
      const schedule = buildEmiSchedule(
        new Prisma.Decimal(String(body.principalAmount)),
        new Prisma.Decimal(String(body.interestRateApr)),
        body.tenureMonths,
        startDate,
        (body.installmentType ?? "MONTHLY") as InstallmentType
      );

      for (const it of schedule) {
        await (tx as any).quotationInstallment.create({
          data: {
            quotation: { connect: { id: q.id } },
            sequence: it.sequence,
            dueDate: it.dueDate,
            principalDue: it.principalDue,
            interestDue: it.interestDue,
            totalDue: it.totalDue,
            status: "PENDING",
            ...tenant,
            taxDue: new Prisma.Decimal(0)
          } as any
        });
      }

      return q;
    });

    const full = await (prisma as any).quotation.findUnique({
      where: { id: row.id },
      include: {
        buyer: true,
        agent: true,
        campaign: true,
        vehicles: { include: { vehicle: true } },
        guarantors: { include: { partner: true } },
        installments: { orderBy: [{ sequence: "asc" }, { dueDate: "asc" }] }
      }
    });
    res.status(201).json(serialize(full ?? row));
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    if (e instanceof Error) {
      res.status(400).json({ error: e.message });
      return;
    }
    next(e);
  }
});

/** Quotations — update (no task queue) */
quotationsRouter.patch("/quotations/:id", async (req, res, next) => {
  try {
    if (!ensureQuotationsAvailable(res)) return;
    const body = quotationUpdate.parse(req.body);
    const existing = await (prisma as any).quotation.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Quotation not found" });

    const filledPartners = body.businessPartners?.filter((r) => r.partnerId.trim()) ?? null;
    const partnerPick = filledPartners ? pickPartners(filledPartners as any) : null;

    const updated = await (prisma as any).quotation.update({
      where: { id: req.params.id },
      data: {
        ...(body.quotationNumber ? { quotationNumber: body.quotationNumber.trim() } : {}),
        ...(body.status ? { status: body.status as any } : {}),
        ...(partnerPick ? { buyerId: partnerPick.buyerId, agentId: partnerPick.agentId ?? undefined } : {}),
        ...(body.campaignId !== undefined ? { campaignId: body.campaignId ?? undefined } : {}),
        ...(body.principalAmount !== undefined
          ? { principalAmount: new Prisma.Decimal(String(body.principalAmount)) }
          : {}),
        ...(body.interestRateApr !== undefined
          ? { interestRateApr: new Prisma.Decimal(String(body.interestRateApr)) }
          : {}),
        ...(body.tenureMonths !== undefined ? { tenureMonths: body.tenureMonths } : {}),
        ...(body.installmentType ? { installmentType: body.installmentType as any } : {}),
        ...(body.balloonAmount !== undefined
          ? { balloonAmount: body.balloonAmount == null ? null : new Prisma.Decimal(String(body.balloonAmount)) }
          : {})
      } as any
    });

    res.json(serialize(updated));
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    if (e instanceof Error) {
      res.status(400).json({ error: e.message });
      return;
    }
    next(e);
  }
});

/** Quotations — generate/installment schedule snapshot */
quotationsRouter.post("/quotations/:id/schedule", async (req, res, next) => {
  try {
    if (!ensureQuotationsAvailable(res)) return;
    const body = scheduleBody.parse(req.body);
    const row = await (prisma as any).quotation.findUnique({
      where: { id: req.params.id },
      include: { vehicles: true }
    });
    if (!row) return res.status(404).json({ error: "Quotation not found" });

    const startDate = new Date(body.startDate);

    const schedule = buildEmiSchedule(
      new Prisma.Decimal(String(row.principalAmount)),
      new Prisma.Decimal(String(row.interestRateApr)),
      row.tenureMonths,
      startDate,
      row.installmentType as InstallmentType
    );

    await prisma.$transaction(async (tx) => {
      await (tx as any).quotation.update({
        where: { id: req.params.id },
        data: { startDate, status: row.status === "CREATED" || row.status === "DRAFT" ? "ISSUED" : row.status } as any
      });
      await (tx as any).quotationInstallment.deleteMany({ where: { quotationId: req.params.id } });
      for (const it of schedule) {
        await (tx as any).quotationInstallment.create({
          data: {
            quotationId: req.params.id,
            sequence: it.sequence,
            dueDate: it.dueDate,
            principalDue: it.principalDue,
            interestDue: it.interestDue,
            totalDue: it.totalDue,
            status: "PENDING"
          } as any
        });
      }
    });

    const out = await (prisma as any).quotation.findUnique({
      where: { id: req.params.id },
      include: { installments: { orderBy: [{ sequence: "asc" }, { dueDate: "asc" }] } }
    });
    res.json(serialize(out));
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    next(e);
  }
});

/** Convert quotation into a contract (creates task queue request first). */
quotationsRouter.post("/quotations/:id/convert", async (req, res, next) => {
  try {
    if (!ensureQuotationsAvailable(res)) return;
    const body = convertBody.parse(req.body);
    const q = await (prisma as any).quotation.findUnique({
      where: { id: req.params.id },
      include: { vehicles: true, guarantors: true }
    });
    if (!q) return res.status(404).json({ error: "Quotation not found" });
    if (q.convertedContractId) {
      return res.status(400).json({ error: "Quotation already converted" });
    }
    const tenantCompanyId = getRequestContext()?.companyId ?? null;
    const tenantBranchId = getRequestContext()?.branchId ?? null;
    if (!tenantCompanyId) return res.status(400).json({ error: "Missing tenant" });
    const tenant = {
      company: { connect: { id: tenantCompanyId } },
      ...(tenantBranchId ? { branch: { connect: { id: tenantBranchId } } } : {})
    } as const;

    const startDate = body.startDate ? new Date(body.startDate) : (q.startDate ? new Date(q.startDate) : null);
    if (!startDate) {
      return res.status(400).json({ error: "Start date required to convert quotation" });
    }

    const created = await prisma.$transaction(async (tx) => {
      const contract = await (tx as any).contract.create({
        data: {
          contractNumber: body.contractNumber.trim(),
          status: "DRAFT",
          buyer: { connect: { id: q.buyerId } },
          ...(q.agentId ? { agent: { connect: { id: q.agentId } } } : {}),
          ...(q.campaignId ? { campaign: { connect: { id: q.campaignId } } } : {}),
          principalAmount: q.principalAmount,
          interestRateApr: q.interestRateApr,
          tenureMonths: q.tenureMonths,
          installmentType: q.installmentType,
          startDate,
          balloonAmount: q.balloonAmount ?? undefined,
          ...tenant
        } as any
      });

      for (const v of q.vehicles ?? []) {
        await (tx as any).contractVehicle.create({
          data: {
            contract: { connect: { id: contract.id } },
            vehicle: { connect: { id: v.vehicleId } },
            salePrice: v.salePrice,
            ...tenant
          } as any
        });
      }

      for (const g of q.guarantors ?? []) {
        await (tx as any).contractGuarantor.create({
          data: {
            contract: { connect: { id: contract.id } },
            partner: { connect: { id: g.partnerId } },
            ...tenant
          } as any
        });
      }

      // Create task queue request first; approval will activate + schedule + auto-receipts (same as contracts flow).
      await (tx as any).taskQueueRequest.create({
        data: {
          contract: { connect: { id: contract.id } },
          requestType: "CONTRACT_CREATE",
          title: `Review: ${contract.contractNumber}`,
          ...tenant
        } as any
      });

      await (tx as any).quotation.update({
        where: { id: q.id },
        data: { status: "CONVERTED", convertedContractId: contract.id } as any
      });

      return contract;
    });

    const full = await (prisma as any).contract.findUnique({
      where: { id: created.id },
      include: { buyer: true, agent: true, campaign: true, vehicles: { include: { vehicle: true } }, guarantors: true }
    });
    res.status(201).json(serialize(full ?? created));
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    if (e instanceof Error) {
      res.status(400).json({ error: e.message });
      return;
    }
    next(e);
  }
});

