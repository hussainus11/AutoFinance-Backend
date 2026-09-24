import { Router } from "express";
import { z } from "zod";
import { Prisma, type InstallmentType } from "@prisma/client";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { buildEmiSchedule, INSTALLMENT_MONTHS_STEP, installmentPeriodCount } from "../services/emi.js";
import { applyLateFeeWaiver } from "../services/late-fee-waiver.js";
import { approveRestructureRequest, createRestructureRequest } from "../services/restructure.js";
import { connectById, tenantConnectOrThrow } from "../services/tenant-helpers.js";
import { notifyTaskQueueUsers } from "../services/notifications.js";
import { getRequestContext } from "../context.js";

export const contractsRouter = Router();

const lateFeeWaiverBody = z
  .object({
    installmentId: z.string().uuid(),
    valueKind: z.enum(["FIXED", "PERCENTAGE"]),
    value: z.union([z.string(), z.number()])
  })
  .strict();

const INSTALLMENT_ENUM_VALUES = new Set<string>([
  "MONTHLY",
  "QUARTERLY",
  "SEMI_ANNUAL",
  "YEARLY"
]);

function assertUuidString(id: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw new Error("Invalid contract id");
  }
}

type SqlExecutor = {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Prisma.PrismaPromise<number>;
};

/**
 * Writes `installmentType` with a literal `UPDATE`.
 * `Contract.id` is Prisma `String` → Postgres **text** (not `@db.Uuid`), so the WHERE clause must compare
 * text to text — do **not** cast the id literal to `uuid` or Postgres errors with `operator does not exist: text = uuid`.
 */
async function persistContractInstallmentType(
  db: SqlExecutor,
  contractId: string,
  installmentType: InstallmentType
): Promise<void> {
  assertUuidString(contractId);
  if (!INSTALLMENT_ENUM_VALUES.has(installmentType)) {
    throw new Error("Invalid installment type");
  }
  await db.$executeRawUnsafe(`
    UPDATE "Contract"
    SET "installmentType" = '${installmentType}'::"InstallmentType"
    WHERE "id" = '${contractId}'
  `);
}

const installmentTypeEnum = z.enum(["MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "YEARLY"]);
const installmentTimingEnum = z.enum(["ARREARS", "ADVANCE"]);

const businessPartnerRow = z.object({
  partnerId: z.string().uuid(),
  role: z.enum(["BUYER", "AGENT", "GUARANTOR"])
});

const contractCreate = z.object({
  contractNumber: z.string().min(1),
  campaignId: z.string().uuid().optional().nullable(),
  downPaymentAmount: z.union([z.string(), z.number()]).optional().nullable(),
  feesAmount: z.union([z.string(), z.number()]).optional().nullable(),
  principalAmount: z.string().or(z.number()),
  interestRateApr: z.string().or(z.number()),
  tenureMonths: z.number().int().positive(),
  installmentType: installmentTypeEnum.optional(),
  installmentTiming: installmentTimingEnum.optional(),
  balloonAmount: z.string().or(z.number()).optional().nullable(),
  /** Agent commission from COMMISSION_CHART (client-calculated); persisted as Commission row when agent set. */
  commissionAmount: z.string().or(z.number()).optional().nullable(),
  vehicleLinks: z
    .array(
      z.object({
        vehicleId: z.string().uuid(),
        salePrice: z.string().or(z.number())
      })
    )
    .min(1),
  /** One buyer (required), at most one agent, any number of guarantors; partner types must match roles. */
  businessPartners: z.array(businessPartnerRow).min(1)
});

const CFG_CONTRACT_PREFIX = "numbering.contract.prefix";
const CFG_CONTRACT_NEXT = "numbering.contract.next";
const CFG_CONTRACT_ALLOW_MANUAL = "numbering.contract.allowManual";

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
  // Lock nextKey row to prevent duplicates under concurrent creates.
  const prefixRows = (await tx.$queryRawUnsafe(
    `SELECT "value" FROM "SystemConfig" WHERE "companyId" = $1 AND "key" = $2 LIMIT 1`,
    companyId,
    prefixKey
  )) as Array<{ value: string }>;
  const prefixRaw = (prefixRows?.[0]?.value ?? "CN-").trim() || "CN-";
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

  // Upsert bumped value
  const bumped =
    inferredPrefix && inferredWidth > 0
      ? `${inferredPrefix}${String(n + 1).padStart(inferredWidth, "0")}`
      : String(n + 1);
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
    bumped
  );

  if (inferredPrefix && inferredWidth > 0) {
    return `${inferredPrefix}${String(n).padStart(inferredWidth, "0")}`;
  }
  return `${prefixRaw}${pad4(n)}`;
}

const scheduleBody = z.object({
  startDate: z.string().datetime(),
  installmentTiming: installmentTimingEnum.optional()
});

const taskRequestWithAssignee = {
  include: { assignedTo: { select: { id: true, email: true, name: true } } }
} as const;

function attachLatestTaskRequest<T extends Record<string, unknown>>(row: T): T {
  const r = row as any;
  if (Array.isArray(r.taskRequests)) {
    r.taskRequest = r.taskRequests[0] ?? null;
    delete r.taskRequests;
  }
  return r;
}

const CONTRACT_STATUSES = new Set([
  "DRAFT",
  "ACTIVE",
  "OVERDUE",
  "COMPLETED",
  "EARLY_PAID",
  "DEFAULTED",
  "CANCELLED",
  "REPOSSESSED",
  "CLOSED"
]);

function buildContractSearchWhere(q: string): Prisma.ContractWhereInput {
  const trimmed = q.trim();
  const or: Prisma.ContractWhereInput[] = [
    { contractNumber: { contains: trimmed, mode: "insensitive" } },
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
  if (CONTRACT_STATUSES.has(statusUpper)) {
    or.push({ status: statusUpper as Prisma.EnumContractStatusFilter["equals"] });
  }
  return { OR: or };
}

/** Contracts page — financing deals + EMI schedule generation. */
contractsRouter.get("/contracts", async (req, res, next) => {
  try {
    const buyerId = typeof req.query.buyerId === "string" ? req.query.buyerId.trim() : "";
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const statusQ = typeof req.query.status === "string" ? req.query.status.trim().toUpperCase() : "";
    const parts: Prisma.ContractWhereInput[] = [];
    if (buyerId) parts.push({ buyerId });
    if (q) parts.push(buildContractSearchWhere(q));
    if (statusQ && CONTRACT_STATUSES.has(statusQ)) parts.push({ status: statusQ as any });
    const where = parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : { AND: parts };
    const rows = await (prisma as any).contract.findMany({
      where,
      include: {
        buyer: true,
        agent: true,
        vehicles: { include: { vehicle: true } },
        taskRequests: { take: 1, orderBy: { createdAt: "desc" }, ...taskRequestWithAssignee },
        installments: { select: { id: true }, take: 1 }
      },
      orderBy: { createdAt: "desc" }
    });
    res.json(serialize((rows ?? []).map(attachLatestTaskRequest)));
  } catch (e) {
    next(e);
  }
});

/**
 * Waivers overview table: overdue contracts + installments with late fee balance.
 * Used by the Waivers datatable (apply waiver row-by-row).
 */
contractsRouter.get("/contracts/overdue/late-fee-balances", async (_req, res, next) => {
  try {
    const rows = await prisma.contract.findMany({
      where: { status: "OVERDUE" },
      include: {
        buyer: true,
        installments: {
          where: { lateFeeAccrued: { gt: 0 } },
          orderBy: [{ dueDate: "asc" }, { sequence: "asc" }]
        }
      },
      orderBy: { createdAt: "desc" }
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

contractsRouter.get("/contracts/:contractId/late-fee-waivers", async (req, res, next) => {
  try {
    if (typeof (prisma as unknown as { lateFeeWaiver?: unknown }).lateFeeWaiver === "undefined") {
      res.status(500).json({
        error:
          "Prisma client is out of date (lateFeeWaiver missing). Stop the API, run `npx prisma generate`, then restart."
      });
      return;
    }
    const contract = await prisma.contract.findUnique({
      where: { id: req.params.contractId },
      select: { id: true }
    });
    if (!contract) return res.status(404).json({ error: "Contract not found" });
    const rows = await prisma.lateFeeWaiver.findMany({
      where: { contractId: req.params.contractId },
      orderBy: { createdAt: "desc" },
      include: { installment: { select: { sequence: true, dueDate: true } } }
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

/** Global waiver history table (all contracts). */
contractsRouter.get("/late-fee-waivers", async (req, res, next) => {
  try {
    if (typeof (prisma as unknown as { lateFeeWaiver?: unknown }).lateFeeWaiver === "undefined") {
      res.status(500).json({
        error:
          "Prisma client is out of date (lateFeeWaiver missing). Stop the API, run `npx prisma generate`, then restart."
      });
      return;
    }
    const take = Math.min(500, Number(req.query.limit) || 200);
    const rows = await prisma.lateFeeWaiver.findMany({
      orderBy: { createdAt: "desc" },
      take,
      include: {
        contract: { select: { contractNumber: true } },
        installment: { select: { sequence: true, dueDate: true } }
      }
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

contractsRouter.post("/contracts/:contractId/late-fee-waivers", async (req, res, next) => {
  try {
    if (typeof (prisma as unknown as { lateFeeWaiver?: unknown }).lateFeeWaiver === "undefined") {
      res.status(500).json({
        error:
          "Prisma client is out of date (lateFeeWaiver missing). Stop the API, run `npx prisma generate`, then restart."
      });
      return;
    }
    const body = lateFeeWaiverBody.parse(req.body);
    const row = await applyLateFeeWaiver(req.params.contractId, {
      installmentId: body.installmentId,
      valueKind: body.valueKind,
      value: body.value
    });
    res.status(201).json(serialize(row));
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

contractsRouter.get("/contracts/:id", async (req, res, next) => {
  try {
    const row = await (prisma as any).contract.findUnique({
      where: { id: req.params.id },
      include: {
        buyer: true,
        agent: true,
        campaign: true,
        vehicles: { include: { vehicle: true } },
        guarantors: { include: { partner: true } },
        installments: { orderBy: [{ sequence: "asc" }, { dueDate: "asc" }] },
        taskRequests: { take: 1, orderBy: { createdAt: "desc" }, ...taskRequestWithAssignee }
      }
    });
    if (!row) return res.status(404).json({ error: "Contract not found" });
    res.json(serialize(attachLatestTaskRequest(row)));
  } catch (e) {
    next(e);
  }
});

const restructureCreateBody = z
  .object({
    pivotInstallmentId: z.string().uuid(),
    startDueDate: z.string().datetime()
  })
  .strict();

contractsRouter.post("/contracts/:id/restructure-requests", async (req, res, next) => {
  try {
    const body = restructureCreateBody.parse(req.body);
    const row = await createRestructureRequest(req.params.id, body.pivotInstallmentId, new Date(body.startDueDate));
    await notifyTaskQueueUsers({
      type: "RESTRUCTURE_REQUEST_CREATED",
      title: "Restructure request created",
      message: `A restructuring request was created for a contract.`,
      href: "/dashboard/autofinance/task-queue"
    });
    res.status(201).json(serialize(row));
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

contractsRouter.post("/restructure-requests/:id/approve", async (req, res, next) => {
  try {
    const row = await approveRestructureRequest(req.params.id);
    res.json(serialize(row));
  } catch (e) {
    if (e instanceof Error) {
      res.status(400).json({ error: e.message });
      return;
    }
    next(e);
  }
});

contractsRouter.get("/contracts/:id/restructure-requests", async (req, res, next) => {
  try {
    if (typeof (prisma as unknown as { restructureRequest?: unknown }).restructureRequest === "undefined") {
      res.status(500).json({
        error:
          "Prisma client is out of date (restructureRequest missing). Stop the API, run `npx prisma generate`, then restart."
      });
      return;
    }
    const rows = await (prisma as any).restructureRequest.findMany({
      where: { contractId: req.params.id },
      orderBy: { createdAt: "desc" },
      take: 50
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

contractsRouter.get("/contracts/:id/installment-history", async (req, res, next) => {
  try {
    if (typeof (prisma as unknown as { installmentHistory?: unknown }).installmentHistory === "undefined") {
      res.status(500).json({
        error:
          "Prisma client is out of date (installmentHistory missing). Stop the API, run `npx prisma generate`, then restart."
      });
      return;
    }
    const take = Math.min(500, Number(req.query.limit) || 200);
    const rows = await (prisma as any).installmentHistory.findMany({
      where: { contractId: req.params.id },
      orderBy: [{ movedAt: "desc" }, { sequence: "asc" }],
      take
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

const contractUpdate = z
  .object({
    principalAmount: z.union([z.string(), z.number()]).optional(),
    interestRateApr: z.union([z.string(), z.number()]).optional(),
    tenureMonths: z.number().int().positive().optional(),
    balloonAmount: z.union([z.string(), z.number(), z.null()]).optional(),
    installmentType: installmentTypeEnum.optional()
  })
  .strict();

contractsRouter.patch("/contracts/:id", async (req, res, next) => {
  try {
    const body = contractUpdate.parse(req.body);
    const contract = await (prisma as any).contract.findUnique({
      where: { id: req.params.id },
      include: {
        taskRequests: { take: 1, orderBy: { createdAt: "desc" }, ...taskRequestWithAssignee },
        installments: true
      }
    });
    if (!contract) return res.status(404).json({ error: "Contract not found" });
    const latest = (contract as any).taskRequests?.[0] ?? null;
    if (!latest || latest.status !== "MODIFICATION_REQUIRED") {
      return res.status(400).json({
        error: "Contract can only be edited when the task queue request is in Modification Required status."
      });
    }
    if (contract.installments.length > 0) {
      return res.status(400).json({ error: "Cannot edit a contract that already has installments." });
    }

    const data: {
      principalAmount?: Prisma.Decimal;
      interestRateApr?: Prisma.Decimal;
      tenureMonths?: number;
      balloonAmount?: Prisma.Decimal | null;
    } = {};
    if (body.principalAmount !== undefined) {
      data.principalAmount = new Prisma.Decimal(String(body.principalAmount));
    }
    if (body.interestRateApr !== undefined) {
      data.interestRateApr = new Prisma.Decimal(String(body.interestRateApr));
    }
    if (body.tenureMonths !== undefined) {
      data.tenureMonths = body.tenureMonths;
    }
    if (body.balloonAmount !== undefined) {
      data.balloonAmount =
        body.balloonAmount === null ? null : new Prisma.Decimal(String(body.balloonAmount));
    }

    const nextTenure = body.tenureMonths ?? contract.tenureMonths;
    const nextType =
      body.installmentType ?? (contract as { installmentType?: InstallmentType }).installmentType ?? "MONTHLY";
    if (body.tenureMonths !== undefined || body.installmentType !== undefined) {
      if (installmentPeriodCount(nextTenure, nextType) <= 0) {
        return res.status(400).json({
          error: `Tenure (${nextTenure} months) must be a multiple of ${INSTALLMENT_MONTHS_STEP[nextType]} for ${nextType} installments.`
        });
      }
    }

    await prisma.contract.update({
      where: { id: req.params.id },
      data
    });
    if (body.installmentType !== undefined) {
      await persistContractInstallmentType(prisma, req.params.id, body.installmentType);
    }
    const updated = await (prisma as any).contract.findUnique({
      where: { id: req.params.id },
      include: {
        buyer: true,
        agent: true,
        campaign: true,
        vehicles: { include: { vehicle: true } },
        taskRequests: { take: 1, orderBy: { createdAt: "desc" }, ...taskRequestWithAssignee }
      }
    });
    if (!updated) return res.status(404).json({ error: "Contract not found" });
    res.json(serialize(attachLatestTaskRequest(updated)));
  } catch (e) {
    next(e);
  }
});

contractsRouter.post("/contracts", async (req, res, next) => {
  try {
    const body = contractCreate.parse(req.body);
    const installmentType: InstallmentType = body.installmentType ?? "MONTHLY";
    if (installmentPeriodCount(body.tenureMonths, installmentType) <= 0) {
      return res.status(400).json({
        error: `Tenure (${body.tenureMonths} months) must be a multiple of ${INSTALLMENT_MONTHS_STEP[installmentType]} for ${installmentType} installments.`
      });
    }

    const seenPartner = new Set<string>();
    for (const row of body.businessPartners) {
      if (seenPartner.has(row.partnerId)) {
        return res.status(400).json({ error: "The same partner cannot be added twice." });
      }
      seenPartner.add(row.partnerId);
    }

    const buyers = body.businessPartners.filter((r) => r.role === "BUYER");
    const agents = body.businessPartners.filter((r) => r.role === "AGENT");
    if (buyers.length !== 1) {
      return res.status(400).json({ error: "Exactly one buyer is required in business partners." });
    }
    if (agents.length > 1) {
      return res.status(400).json({ error: "At most one agent is allowed in business partners." });
    }

    const partnerIds = [...seenPartner];
    const partnerRows = await (prisma as any).partner.findMany({ where: { id: { in: partnerIds } } });
    const byId = new Map(partnerRows.map((p) => [p.id, p]));
    for (const row of body.businessPartners) {
      const p = byId.get(row.partnerId) as any;
      if (!p) {
        return res.status(400).json({ error: "One or more partners were not found." });
      }
      const expected =
        row.role === "BUYER" ? "BUYER" : row.role === "AGENT" ? "AGENT" : "GUARANTOR";
      if (p.type !== expected) {
        return res.status(400).json({
          error: `Partner "${p.displayName}" must have type ${expected} for role ${row.role}.`
        });
      }
    }

    const buyerId = buyers[0].partnerId;
    const agentId = agents[0]?.partnerId ?? undefined;
    const guarantorIds = body.businessPartners.filter((r) => r.role === "GUARANTOR").map((r) => r.partnerId);

    if (body.campaignId) {
      const c = await prisma.campaign.findUnique({
        where: { id: body.campaignId },
        include: { vehicles: true }
      });
      if (!c) return res.status(400).json({ error: "Invalid campaign" });
      if (!c.isActive) return res.status(400).json({ error: "Campaign is not active" });
      const today = new Date();
      if (!c.allowBackdatedContracts) {
        // Contract dates are not yet persisted on draft creation; enforce basic guard by disallowing
        // drafts when campaign forbids backdating and a client tries to create using a past date later.
        // (Full enforcement will be added once contractDate is stored.)
        void today;
      }
      const allowed = new Set(c.vehicles.map((x) => x.vehicleId));
      for (const v of body.vehicleLinks) {
        if (!allowed.has(v.vehicleId)) {
          return res.status(400).json({ error: "Selected vehicle is not in campaign" });
        }
      }
      if (c.tenureMonthsOptions.length > 0 && !c.tenureMonthsOptions.includes(body.tenureMonths)) {
        return res.status(400).json({ error: "Tenure is not allowed for this campaign" });
      }
    }

    const commissionRaw =
      body.commissionAmount != null && body.commissionAmount !== ""
        ? new Prisma.Decimal(String(body.commissionAmount))
        : null;
    if (commissionRaw && commissionRaw.gt(0)) {
      if (!agentId) {
        return res.status(400).json({ error: "Agent is required when commission applies" });
      }
      const agent = byId.get(agentId) as any;
      if (!agent || agent.type !== "AGENT") {
        return res.status(400).json({ error: "Commission requires a partner of type AGENT" });
      }
    }

    const row = await prisma.$transaction(async (tx: any) => {
      const tenant = tenantConnectOrThrow();
      const companyId = tenant.company.connect.id;

      // Auto numbering: if manual override is disabled, generate contractNumber and bump counter.
      let contractNumber = body.contractNumber;
      try {
        const allowRows = (await tx.$queryRawUnsafe(
          `SELECT "value" FROM "SystemConfig" WHERE "companyId" = $1 AND "key" = $2 LIMIT 1`,
          companyId,
          CFG_CONTRACT_ALLOW_MANUAL
        )) as Array<{ value: string }>;
        const allowManual = parseBool(allowRows?.[0]?.value, false);
        if (!allowManual) {
          contractNumber = await nextNumberFromSystemConfig(tx, companyId, CFG_CONTRACT_PREFIX, CFG_CONTRACT_NEXT);
        }
      } catch {
        // If SystemConfig isn't available yet, fall back to the provided number.
      }

      const createDataRel = {
        contractNumber,
        company: tenant.company,
        branch: (tenant as any).branch,
        buyer: { connect: { id: buyerId } },
        agent: agentId ? { connect: { id: agentId } } : undefined,
        campaign: body.campaignId ? { connect: { id: body.campaignId } } : undefined,
        downPaymentAmount:
          body.downPaymentAmount == null ? undefined : new Prisma.Decimal(String(body.downPaymentAmount)),
        feesAmount: body.feesAmount == null ? undefined : new Prisma.Decimal(String(body.feesAmount)),
        principalAmount: new Prisma.Decimal(String(body.principalAmount)),
        interestRateApr: new Prisma.Decimal(String(body.interestRateApr)),
        tenureMonths: body.tenureMonths,
        balloonAmount: body.balloonAmount != null ? new Prisma.Decimal(String(body.balloonAmount)) : null,
        installmentTiming: body.installmentTiming ?? "ARREARS",
        vehicles: {
          create: body.vehicleLinks.map((v) => ({
            company: tenant.company,
            branch: (tenant as any).branch,
            vehicle: { connect: { id: v.vehicleId } },
            salePrice: new Prisma.Decimal(String(v.salePrice))
          }))
        },
        guarantors: guarantorIds.length
          ? {
              create: guarantorIds.map((partnerId) => ({
                company: tenant.company,
                branch: (tenant as any).branch,
                partner: { connect: { id: partnerId } }
              }))
            }
          : undefined
      } as any;

      let created: any;
      try {
        created = await tx.contract.create({
          data: createDataRel,
          include: { vehicles: true, guarantors: true }
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Fallback for out-of-date Prisma Client/input variants: use scalar companyId/branchId instead of relation connect.
        if (msg.includes("Argument `company` is missing")) {
          const branchId = getRequestContext()?.branchId ?? null;
          created = await tx.contract.create({
            data: {
              ...createDataRel,
              company: { connect: { id: companyId } },
              ...(branchId ? { branch: { connect: { id: branchId } } } : {}),
              companyId,
              ...(branchId ? { branchId } : {})
            } as any,
            include: { vehicles: true, guarantors: true }
          });
        } else {
          throw e;
        }
      }

      await persistContractInstallmentType(tx, created.id, installmentType);

      await tx.taskQueueRequest.create({
        data: {
          contract: { connect: { id: created.id } },
          requestType: "CONTRACT_CREATE",
          title: `Review: ${created.contractNumber}`
        }
      });

      if (agentId && commissionRaw && commissionRaw.gt(0)) {
        await tx.commission.create({
          data: {
            contract: { connect: { id: created.id } },
            agent: { connect: { id: agentId } },
            amount: commissionRaw
          }
        });
      }

      return created;
    });

    const withTask = await (prisma as any).contract.findUnique({
      where: { id: row.id },
      include: {
        vehicles: true,
        guarantors: true,
        taskRequests: { take: 1, orderBy: { createdAt: "desc" }, ...taskRequestWithAssignee }
      }
    });
    await notifyTaskQueueUsers({
      type: "CONTRACT_CREATED",
      title: "Contract created",
      message: `A new contract was created: ${(row as any)?.contractNumber ?? ""}`.trim(),
      href: "/dashboard/autofinance/task-queue"
    });
    res.status(201).json(serialize(withTask ? attachLatestTaskRequest(withTask) : row));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = (e.meta?.target as string[] | undefined) ?? [];
      if (target.includes("contractNumber")) {
        return res.status(409).json({
          error: "A contract with this contract number already exists. Use a different contract number."
        });
      }
    }
    next(e);
  }
});

contractsRouter.post("/contracts/:id/schedule", async (req, res, next) => {
  try {
    const { startDate, installmentTiming: scheduleTiming } = scheduleBody.parse(req.body);
    const contract = await prisma.contract.findUnique({
      where: { id: req.params.id },
      include: { installments: true, vehicles: { include: { vehicle: true } } }
    });
    if (!contract) return res.status(404).json({ error: "Contract not found" });
    if (contract.installments.length > 0) {
      return res.status(400).json({ error: "Schedule already generated" });
    }

    const start = new Date(startDate);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const nextStatus = start < startOfToday ? ("OVERDUE" as const) : ("ACTIVE" as const);
    const scheduleType =
      (contract as { installmentType?: InstallmentType }).installmentType ?? "MONTHLY";
    const timing =
      (scheduleTiming as "ARREARS" | "ADVANCE" | undefined) ??
      ((contract as { installmentTiming?: "ARREARS" | "ADVANCE" }).installmentTiming ?? "ARREARS");
    const monthsStep = INSTALLMENT_MONTHS_STEP[scheduleType] ?? 1;
    const anchor = new Date(start);
    if (timing === "ADVANCE") {
      anchor.setMonth(anchor.getMonth() - monthsStep);
    }
    const rows = buildEmiSchedule(
      contract.principalAmount,
      contract.interestRateApr,
      contract.tenureMonths,
      anchor,
      scheduleType
    );

    await prisma.$transaction(async (tx) => {
      await tx.installment.createMany({
        data: rows.map((r) => ({
          contractId: contract.id,
          sequence: r.sequence,
          dueDate: r.dueDate,
          principalDue: r.principalDue,
          interestDue: r.interestDue,
          taxDue: new Prisma.Decimal(0),
          totalDue: r.totalDue,
          paidAmount: new Prisma.Decimal(0),
          principalPaid: new Prisma.Decimal(0),
          interestPaid: new Prisma.Decimal(0),
          taxPaid: new Prisma.Decimal(0),
          status: "PENDING" as const
        }))
      });
      await tx.contract.update({
        where: { id: contract.id },
        data: {
          status: nextStatus,
          startDate: start,
          ...(scheduleTiming ? { installmentTiming: timing } : {})
        }
      });
      const vids = contract.vehicles.map((cv) => cv.vehicleId);
      if (vids.length) {
        await tx.vehicle.updateMany({
          where: { id: { in: vids } },
          data: { status: "FINANCED" }
        });
      }
    });

    const updated = await prisma.contract.findUnique({
      where: { id: contract.id },
      include: { installments: true }
    });
    res.json(serialize(updated));
  } catch (e) {
    next(e);
  }
});
