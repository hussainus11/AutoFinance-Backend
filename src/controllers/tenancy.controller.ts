import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { ensureDefaultAccounting } from "../services/accounting-defaults.js";
import { getRequestContext } from "../context.js";
import { hashPassword } from "../auth/password.js";
import { ensureUniqueCompanySlug } from "../services/company-slug.js";

export const tenancyRouter = Router();

function ensureTenancyAvailable(res: { status: (c: number) => any; json: (v: any) => any }): boolean {
  const p = prisma as unknown as { company?: unknown; branch?: unknown; user?: unknown };
  if (typeof p.company === "undefined" || typeof p.branch === "undefined" || typeof p.user === "undefined") {
    res.status(500).json({
      error:
        "Prisma client is out of date (Company/Branch/User missing). Stop the API, run `npm run db:deploy`, then `npx prisma generate`, then restart."
    });
    return false;
  }
  return true;
}

const createCompanyBody = z
  .object({
    companyName: z.string().min(2),
    branchName: z.string().optional().nullable(),
    adminEmail: z.string().email(),
    adminName: z.string().optional().nullable(),
    adminPassword: z.string().min(8),
    company: z
      .object({
        code: z.string().optional().nullable(),
        legalName: z.string().optional().nullable(),
        email: z.string().optional().nullable(),
        phone: z.string().optional().nullable(),
        whatsappNumber: z.string().optional().nullable(),
        website: z.string().optional().nullable(),
        registrationNo: z.string().optional().nullable(),
        taxNo: z.string().optional().nullable(),
        logoUrl: z.string().optional().nullable(),
        currencyCode: z.string().min(3).max(3).optional().nullable(),
        addressLine1: z.string().optional().nullable(),
        addressLine2: z.string().optional().nullable(),
        city: z.string().optional().nullable(),
        stateRegion: z.string().optional().nullable(),
        postalCode: z.string().optional().nullable(),
        country: z.string().optional().nullable(),
        notes: z.string().optional().nullable()
      })
      .optional()
      .nullable(),
    branch: z
      .object({
        code: z.string().optional().nullable(),
        email: z.string().optional().nullable(),
        phone: z.string().optional().nullable(),
        addressLine1: z.string().optional().nullable(),
        addressLine2: z.string().optional().nullable(),
        city: z.string().optional().nullable(),
        stateRegion: z.string().optional().nullable(),
        postalCode: z.string().optional().nullable(),
        country: z.string().optional().nullable()
      })
      .optional()
      .nullable(),
    admin: z
      .object({
        phone: z.string().optional().nullable()
      })
      .optional()
      .nullable()
  })
  .strict();

const companyUpdateBody = z
  .object({
    name: z.string().min(2).optional(),
    code: z.string().optional().nullable(),
    legalName: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    whatsappNumber: z.string().optional().nullable(),
    emails: z.array(z.string().min(1)).optional(),
    phones: z.array(z.string().min(1)).optional(),
    website: z.string().optional().nullable(),
    regNo: z.string().optional().nullable(),
    ntn: z.string().optional().nullable(),
    logoUrl: z.string().optional().nullable(),
    currencyCode: z.string().min(3).max(3).optional(),
    addressLine1: z.string().optional().nullable(),
    addressLine2: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    stateRegion: z.string().optional().nullable(),
    postalCode: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
    addresses: z.array(z.string().min(1)).optional(),
    notes: z.string().optional().nullable(),
    isActive: z.boolean().optional()
  })
  .strict();

const createBranchBody = z
  .object({
    name: z.string().min(2),
    code: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    whatsappNumber: z.string().optional().nullable(),
    addressLine1: z.string().optional().nullable(),
    addressLine2: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    stateRegion: z.string().optional().nullable(),
    postalCode: z.string().optional().nullable(),
    country: z.string().optional().nullable()
  })
  .strict();

/** Onboarding — create a company and (optional) branch. */
tenancyRouter.post("/tenancy/onboarding", async (req, res, next) => {
  try {
    if (!ensureTenancyAvailable(res)) return;
    const body = createCompanyBody.parse(req.body);

    const out = await prisma.$transaction(async (tx) => {
      const slug = await ensureUniqueCompanySlug(tx as any, body.companyName);
      const company = await (tx as any).company.create({
        data: {
          name: body.companyName.trim(),
          slug,
          code: body.company?.code ?? undefined,
          legalName: body.company?.legalName ?? undefined,
          email: body.company?.email ?? undefined,
          phone: body.company?.phone ?? undefined,
          whatsappNumber: body.company?.whatsappNumber ?? undefined,
          website: body.company?.website ?? undefined,
          regNo: body.company?.registrationNo ?? undefined,
          ntn: body.company?.taxNo ?? undefined,
          logoUrl: body.company?.logoUrl ?? undefined,
          currencyCode: body.company?.currencyCode ?? undefined,
          addressLine1: body.company?.addressLine1 ?? undefined,
          addressLine2: body.company?.addressLine2 ?? undefined,
          city: body.company?.city ?? undefined,
          stateRegion: body.company?.stateRegion ?? undefined,
          postalCode: body.company?.postalCode ?? undefined,
          country: body.company?.country ?? undefined,
          notes: body.company?.notes ?? undefined
        } as any
      });
      const branchName = (body.branchName ?? "").trim();
      const branch =
        branchName.length > 0
          ? await (tx as any).branch.create({
              data: {
                companyId: company.id,
                name: branchName,
                code: body.branch?.code ?? undefined,
                email: body.branch?.email ?? undefined,
                phone: body.branch?.phone ?? undefined,
                addressLine1: body.branch?.addressLine1 ?? undefined,
                addressLine2: body.branch?.addressLine2 ?? undefined,
                city: body.branch?.city ?? undefined,
                stateRegion: body.branch?.stateRegion ?? undefined,
                postalCode: body.branch?.postalCode ?? undefined,
                country: body.branch?.country ?? undefined
              } as any
            })
          : null;
      const user = await (tx as any).user.create({
        data: {
          email: body.adminEmail.toLowerCase(),
          name: body.adminName ?? undefined,
          phone: body.admin?.phone ?? undefined,
          passwordHash: hashPassword(body.adminPassword),
          role: "ADMIN",
          companyId: company.id,
          branchId: branch?.id ?? null
        } as any
      });
      await ensureDefaultAccounting(tx as any, { companyId: company.id, branchId: branch?.id ?? null });
      return { company, branch, user };
    });

    res.status(201).json(
      serialize({
        companyId: out.company.id,
        branchId: out.branch?.id ?? null,
        adminUserId: out.user.id
      })
    );
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    const maybePrisma = e as { code?: string; meta?: unknown };
    if (maybePrisma?.code === "P2002") {
      const target = (maybePrisma.meta as { target?: string[] } | undefined)?.target ?? [];
      if (Array.isArray(target) && target.includes("name")) {
        res.status(409).json({ error: "Company name already exists. Please choose a different name." });
        return;
      }
      if (Array.isArray(target) && target.includes("email")) {
        res.status(409).json({ error: "Admin email already exists. Please use a different email." });
        return;
      }
      res.status(409).json({ error: "Unique constraint violation. Please use different values." });
      return;
    }
    next(e);
  }
});

/** Company info — current tenant company */
tenancyRouter.get("/tenancy/company", async (_req, res, next) => {
  try {
    if (!ensureTenancyAvailable(res)) return;
    const companyId = getRequestContext()?.companyId;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });
    try {
      const row = await (prisma as any).company.findUnique({ where: { id: companyId } });
      if (!row) return res.status(404).json({ error: "Company not found" });
      res.json(serialize(row));
    } catch (e) {
      // Prisma client may be out of date and not know about the new array columns.
      // Fall back to raw SQL select to keep the UI working.
      try {
        const row = await prisma.$queryRaw<
          Array<{
            id: string;
            name: string;
            code: string | null;
            legalName: string | null;
            email: string | null;
            phone: string | null;
            whatsappNumber: string | null;
            website: string | null;
            logoUrl: string | null;
            ntn: string | null;
            regNo: string | null;
            currencyCode: string;
            addressLine1: string | null;
            addressLine2: string | null;
            city: string | null;
            stateRegion: string | null;
            postalCode: string | null;
            country: string | null;
            notes: string | null;
            isActive: boolean;
            phones: string[];
            emails: string[];
            addresses: string[];
            createdAt: Date;
            updatedAt: Date;
          }>
        >`
          SELECT
            "id","name","code","legalName","email","phone","whatsappNumber","website","logoUrl","ntn","regNo","currencyCode",
            "addressLine1","addressLine2","city","stateRegion","postalCode","country",
            "notes","isActive",
            COALESCE("phones", ARRAY[]::TEXT[]) AS "phones",
            COALESCE("emails", ARRAY[]::TEXT[]) AS "emails",
            COALESCE("addresses", ARRAY[]::TEXT[]) AS "addresses",
            "createdAt","updatedAt"
          FROM "Company"
          WHERE "id" = ${companyId}
          LIMIT 1
        `;
        if (!row?.[0]) return res.status(404).json({ error: "Company not found" });
        res.json(serialize(row[0]));
      } catch (rawErr) {
        const msg = rawErr instanceof Error ? rawErr.message : String(rawErr);
        // DB not migrated yet (e.g. whatsappNumber missing) — return a compatible shape.
        if (msg.includes("whatsappNumber") && msg.includes("does not exist")) {
          const row = await prisma.$queryRaw<
            Array<{
              id: string;
              name: string;
              code: string | null;
              legalName: string | null;
              email: string | null;
              phone: string | null;
              website: string | null;
              logoUrl: string | null;
              ntn: string | null;
              regNo: string | null;
              currencyCode: string;
              addressLine1: string | null;
              addressLine2: string | null;
              city: string | null;
              stateRegion: string | null;
              postalCode: string | null;
              country: string | null;
              notes: string | null;
              isActive: boolean;
              phones: string[];
              emails: string[];
              addresses: string[];
              createdAt: Date;
              updatedAt: Date;
            }>
          >`
            SELECT
              "id","name","code","legalName","email","phone","website","logoUrl","ntn","regNo","currencyCode",
              "addressLine1","addressLine2","city","stateRegion","postalCode","country",
              "notes","isActive",
              COALESCE("phones", ARRAY[]::TEXT[]) AS "phones",
              COALESCE("emails", ARRAY[]::TEXT[]) AS "emails",
              COALESCE("addresses", ARRAY[]::TEXT[]) AS "addresses",
              "createdAt","updatedAt"
            FROM "Company"
            WHERE "id" = ${companyId}
            LIMIT 1
          `;
          if (!row?.[0]) return res.status(404).json({ error: "Company not found" });
          res.json(serialize({ ...row[0], whatsappNumber: null }));
          return;
        }
        throw rawErr;
      }
    }
  } catch (e) {
    next(e);
  }
});

/** Company info — update current tenant company */
tenancyRouter.patch("/tenancy/company", async (req, res, next) => {
  try {
    if (!ensureTenancyAvailable(res)) return;
    const companyId = getRequestContext()?.companyId;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });
    const body = companyUpdateBody.parse(req.body);

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.code !== undefined) data.code = body.code ?? undefined;
    if (body.legalName !== undefined) data.legalName = body.legalName ?? undefined;
    if (body.email !== undefined) data.email = body.email ?? undefined;
    if (body.phone !== undefined) data.phone = body.phone ?? undefined;
    if (body.whatsappNumber !== undefined) data.whatsappNumber = body.whatsappNumber ?? undefined;
    if (body.emails !== undefined) data.emails = body.emails;
    if (body.phones !== undefined) data.phones = body.phones;
    if (body.website !== undefined) data.website = body.website ?? undefined;
    if (body.regNo !== undefined) data.regNo = body.regNo ?? undefined;
    if (body.ntn !== undefined) data.ntn = body.ntn ?? undefined;
    if (body.logoUrl !== undefined) data.logoUrl = body.logoUrl ?? undefined;
    if (body.currencyCode !== undefined) data.currencyCode = body.currencyCode;
    if (body.addressLine1 !== undefined) data.addressLine1 = body.addressLine1 ?? undefined;
    if (body.addressLine2 !== undefined) data.addressLine2 = body.addressLine2 ?? undefined;
    if (body.city !== undefined) data.city = body.city ?? undefined;
    if (body.stateRegion !== undefined) data.stateRegion = body.stateRegion ?? undefined;
    if (body.postalCode !== undefined) data.postalCode = body.postalCode ?? undefined;
    if (body.country !== undefined) data.country = body.country ?? undefined;
    if (body.addresses !== undefined) data.addresses = body.addresses;
    if (body.notes !== undefined) data.notes = body.notes ?? undefined;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    if (!Object.keys(data).length) {
      const existing = await (prisma as any).company.findUnique({ where: { id: companyId } });
      return res.json(serialize(existing));
    }

    try {
      const row = await (prisma as any).company.update({ where: { id: companyId }, data });
      res.json(serialize(row));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Prisma client out-of-date: does not recognize new columns (emails/phones/addresses).
      if (msg.includes("Unknown argument `emails`") || msg.includes("Unknown argument `phones`") || msg.includes("Unknown argument `addresses`")) {
        // Guard: ensure columns exist (migration applied); otherwise return a clear message.
        const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'Company'
            AND column_name IN ('phones','emails','addresses')
        `;
        const colSet = new Set(cols.map((c) => c.column_name));
        if (!colSet.has("phones") || !colSet.has("emails") || !colSet.has("addresses")) {
          res.status(500).json({
            error:
              "Database is missing Company contact array columns. Stop the API, run `npm run db:deploy`, then restart."
          });
          return;
        }

        // Normalize values: Prisma update used `undefined` to mean "no change". Here we only update keys that exist in `data`.
        const get = <T>(k: string) => (Object.prototype.hasOwnProperty.call(data, k) ? (data as any)[k] : undefined) as T | undefined;

        const updated = await prisma.$queryRaw<
          Array<{
            id: string;
            name: string;
            code: string | null;
            legalName: string | null;
            email: string | null;
            phone: string | null;
            website: string | null;
            logoUrl: string | null;
            ntn: string | null;
            regNo: string | null;
            currencyCode: string;
            addressLine1: string | null;
            addressLine2: string | null;
            city: string | null;
            stateRegion: string | null;
            postalCode: string | null;
            country: string | null;
            notes: string | null;
            isActive: boolean;
            phones: string[];
            emails: string[];
            addresses: string[];
            createdAt: Date;
            updatedAt: Date;
          }>
        >`
          UPDATE "Company"
          SET
            "name" = COALESCE(${get<string>("name")}::TEXT, "name"),
            "code" = COALESCE(${get<string | null>("code")}::TEXT, "code"),
            "legalName" = COALESCE(${get<string | null>("legalName")}::TEXT, "legalName"),
            "email" = COALESCE(${get<string | null>("email")}::TEXT, "email"),
            "phone" = COALESCE(${get<string | null>("phone")}::TEXT, "phone"),
            "whatsappNumber" = COALESCE(${get<string | null>("whatsappNumber")}::TEXT, "whatsappNumber"),
            "website" = COALESCE(${get<string | null>("website")}::TEXT, "website"),
            "logoUrl" = COALESCE(${get<string | null>("logoUrl")}::TEXT, "logoUrl"),
            "ntn" = COALESCE(${get<string | null>("ntn")}::TEXT, "ntn"),
            "regNo" = COALESCE(${get<string | null>("regNo")}::TEXT, "regNo"),
            "currencyCode" = COALESCE(${get<string>("currencyCode")}::TEXT, "currencyCode"),
            "addressLine1" = COALESCE(${get<string | null>("addressLine1")}::TEXT, "addressLine1"),
            "addressLine2" = COALESCE(${get<string | null>("addressLine2")}::TEXT, "addressLine2"),
            "city" = COALESCE(${get<string | null>("city")}::TEXT, "city"),
            "stateRegion" = COALESCE(${get<string | null>("stateRegion")}::TEXT, "stateRegion"),
            "postalCode" = COALESCE(${get<string | null>("postalCode")}::TEXT, "postalCode"),
            "country" = COALESCE(${get<string | null>("country")}::TEXT, "country"),
            "notes" = COALESCE(${get<string | null>("notes")}::TEXT, "notes"),
            "isActive" = COALESCE(${get<boolean>("isActive")}::BOOLEAN, "isActive"),
            "phones" = COALESCE(${get<string[]>("phones")}::TEXT[], "phones"),
            "emails" = COALESCE(${get<string[]>("emails")}::TEXT[], "emails"),
            "addresses" = COALESCE(${get<string[]>("addresses")}::TEXT[], "addresses"),
            "updatedAt" = NOW()
          WHERE "id" = ${companyId}
          RETURNING
            "id","name","code","legalName","email","phone","whatsappNumber","website","logoUrl","ntn","regNo","currencyCode",
            "addressLine1","addressLine2","city","stateRegion","postalCode","country",
            "notes","isActive",
            COALESCE("phones", ARRAY[]::TEXT[]) AS "phones",
            COALESCE("emails", ARRAY[]::TEXT[]) AS "emails",
            COALESCE("addresses", ARRAY[]::TEXT[]) AS "addresses",
            "createdAt","updatedAt"
        `;
        res.json(serialize(updated?.[0] ?? {}));
        return;
      }
      throw e;
    }
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    const maybePrisma = e as { code?: string; meta?: unknown };
    if (maybePrisma?.code === "P2002") {
      const target = (maybePrisma.meta as { target?: string[] } | undefined)?.target ?? [];
      if (Array.isArray(target) && target.includes("name")) {
        res.status(409).json({ error: "Company name already exists. Please choose a different name." });
        return;
      }
      res.status(409).json({ error: "Unique constraint violation. Please use different values." });
      return;
    }
    next(e);
  }
});

/** Branches — list branches for current tenant company */
tenancyRouter.get("/tenancy/branches", async (_req, res, next) => {
  try {
    if (!ensureTenancyAvailable(res)) return;
    const companyId = getRequestContext()?.companyId;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });
    const rows = await (prisma as any).branch.findMany({
      where: { companyId },
      orderBy: { createdAt: "asc" }
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

/** Branches — create branch for current tenant company */
tenancyRouter.post("/tenancy/branches", async (req, res, next) => {
  try {
    if (!ensureTenancyAvailable(res)) return;
    const companyId = getRequestContext()?.companyId;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });
    const body = createBranchBody.parse(req.body);
    const row = await (prisma as any).branch.create({
      data: {
        companyId,
        name: body.name.trim(),
        code: body.code ?? undefined,
        email: body.email ?? undefined,
        phone: body.phone ?? undefined,
        whatsappNumber: body.whatsappNumber ?? undefined,
        addressLine1: body.addressLine1 ?? undefined,
        addressLine2: body.addressLine2 ?? undefined,
        city: body.city ?? undefined,
        stateRegion: body.stateRegion ?? undefined,
        postalCode: body.postalCode ?? undefined,
        country: body.country ?? undefined
      } as any
    });
    res.status(201).json(serialize(row));
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    next(e);
  }
});

