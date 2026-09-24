import { randomUUID } from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { notifyAdminUsers } from "../services/notifications.js";
import { getRequestContext } from "../context.js";
import { generateRefreshTokenRaw, hashRefreshToken } from "../auth/jwt.js";

export const partnersRouter = Router();

const phoneTypes = [
  "MOBILE",
  "HOME",
  "WORK",
  "FAX",
  "WHATSAPP",
  "OTHER"
] as const;
const emailTypes = ["PERSONAL", "WORK", "OTHER"] as const;
const addressTypes = [
  "REGISTERED",
  "MAILING",
  "RESIDENTIAL",
  "WORK",
  "OTHER"
] as const;
const documentTypes = [
  "NATIONAL_ID",
  "PASSPORT",
  "DRIVERS_LICENSE",
  "PROOF_OF_ADDRESS",
  "BANK_STATEMENT",
  "PAYSLIP",
  "TAX_RETURN",
  "VEHICLE_REGISTRATION",
  "INSURANCE",
  "OTHER"
] as const;

const phoneSchema = z.object({
  phoneNumber: z.string().min(1),
  phoneType: z.enum(phoneTypes).optional().default("MOBILE"),
  isPrimary: z.boolean().optional().default(false),
  label: z.string().optional().nullable()
});

const emailSchema = z.object({
  email: z.string().email(),
  emailType: z.enum(emailTypes).optional().default("PERSONAL"),
  isPrimary: z.boolean().optional().default(false)
});

const addressSchema = z.object({
  addressType: z.enum(addressTypes).optional().default("RESIDENTIAL"),
  line1: z.string().min(1),
  line2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  stateRegion: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  isPrimary: z.boolean().optional().default(false)
});

const documentSchema = z.object({
  documentType: z.enum(documentTypes),
  title: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
  fileUrl: z.string().optional().nullable(),
  mimeType: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  verifiedAt: z.coerce.date().optional().nullable()
});

const partnerScalars = z.object({
  type: z.enum(["BUYER", "AGENT", "GUARANTOR", "PREVIOUS_OWNER"]),
  displayName: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  nationalId: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  riskNotes: z.string().optional().nullable(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  salutation: z.string().optional().nullable(),
  firstName: z.string().optional().nullable(),
  middleName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  dateOfBirth: z.coerce.date().optional().nullable(),
  gender: z.enum(["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"]).optional().nullable(),
  maritalStatus: z
    .enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "SEPARATED"])
    .optional()
    .nullable(),
  nationality: z.string().optional().nullable(),
  employmentStatus: z
    .enum(["EMPLOYED", "SELF_EMPLOYED", "UNEMPLOYED", "RETIRED", "STUDENT", "OTHER"])
    .optional()
    .nullable(),
  employerName: z.string().optional().nullable(),
  jobTitle: z.string().optional().nullable(),
  monthlyIncome: z.union([z.string(), z.number()]).optional().nullable(),
  relationshipToBorrower: z.string().optional().nullable(),
  phones: z.array(phoneSchema).optional().default([]),
  emails: z.array(emailSchema).optional().default([]),
  addresses: z.array(addressSchema).optional().default([]),
  documents: z.array(documentSchema).optional().default([])
});

const partnerCreate = partnerScalars;
const partnerUpdate = partnerScalars.partial();

const partnerInclude = {
  phones: { orderBy: { isPrimary: "desc" as const } },
  emails: { orderBy: { isPrimary: "desc" as const } },
  addresses: { orderBy: { isPrimary: "desc" as const } },
  documents: { orderBy: { createdAt: "desc" as const } }
} satisfies Prisma.PartnerInclude;

function toDecimal(v: string | number | null | undefined): Prisma.Decimal | null | undefined {
  if (v === null) return null;
  if (v === undefined || v === "") return undefined;
  return new Prisma.Decimal(typeof v === "number" ? v : String(v));
}

function stripUndefined<T extends Record<string, unknown>>(o: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function buildCreateInput(body: z.infer<typeof partnerCreate>): any {
  const { phones, emails, addresses, documents, monthlyIncome, ...rest } = body;
  const income = toDecimal(monthlyIncome ?? undefined);
  const base = stripUndefined({
    ...rest,
    monthlyIncome: income === undefined ? undefined : income
  }) as any;

  const data: any = { ...base };
  if (phones.length) {
    data.phones = {
      create: phones.map((p) => ({
        phoneNumber: p.phoneNumber,
        phoneType: p.phoneType,
        isPrimary: p.isPrimary,
        label: p.label ?? undefined
      }))
    };
  }
  if (emails.length) {
    data.emails = {
      create: emails.map((e) => ({
        email: e.email,
        emailType: e.emailType,
        isPrimary: e.isPrimary
      }))
    };
  }
  if (addresses.length) {
    data.addresses = {
      create: addresses.map((a) => ({
        addressType: a.addressType,
        line1: a.line1,
        line2: a.line2 ?? undefined,
        city: a.city ?? undefined,
        stateRegion: a.stateRegion ?? undefined,
        postalCode: a.postalCode ?? undefined,
        country: a.country ?? undefined,
        isPrimary: a.isPrimary
      }))
    };
  }
  if (documents.length) {
    data.documents = {
      create: documents.map((d) => ({
        documentType: d.documentType,
        title: d.title ?? undefined,
        fileName: d.fileName ?? undefined,
        fileUrl: d.fileUrl ?? undefined,
        mimeType: d.mimeType ?? undefined,
        notes: d.notes ?? undefined,
        verifiedAt: d.verifiedAt ?? undefined
      }))
    };
  }
  return data;
}

function buildUpdateInput(patch: z.infer<typeof partnerUpdate>): Prisma.PartnerUpdateInput {
  const { phones, emails, addresses, documents, monthlyIncome, ...rest } = patch;
  const raw = stripUndefined(rest as Record<string, unknown>);
  const data = raw as Prisma.PartnerUpdateInput;
  if (monthlyIncome !== undefined) {
    data.monthlyIncome = monthlyIncome === null ? null : toDecimal(monthlyIncome);
  }
  return data;
}

function buildPartnerSearchWhere(q: string): Prisma.PartnerWhereInput {
  const trimmed = q.trim();
  const digits = trimmed.replace(/\D/g, "");
  const or: Prisma.PartnerWhereInput[] = [
    { displayName: { contains: trimmed, mode: "insensitive" } },
    { firstName: { contains: trimmed, mode: "insensitive" } },
    { middleName: { contains: trimmed, mode: "insensitive" } },
    { lastName: { contains: trimmed, mode: "insensitive" } },
    { nationalId: { contains: trimmed, mode: "insensitive" } },
    { phone: { contains: trimmed, mode: "insensitive" } },
    { phones: { some: { phoneNumber: { contains: trimmed, mode: "insensitive" } } } }
  ];
  if (digits.length >= 3 && digits !== trimmed) {
    or.push({ nationalId: { contains: digits, mode: "insensitive" } });
    or.push({ phone: { contains: digits, mode: "insensitive" } });
    or.push({ phones: { some: { phoneNumber: { contains: digits, mode: "insensitive" } } } });
  }
  return { OR: or };
}

/** Partners — KYC-style profiles with phones, emails, addresses, documents. */
partnersRouter.get("/partners", async (req, res, next) => {
  try {
    const typeQ = req.query.type;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const parts: Prisma.PartnerWhereInput[] = [];
    if (
      typeof typeQ === "string" &&
      ["BUYER", "AGENT", "GUARANTOR", "PREVIOUS_OWNER"].includes(typeQ)
    ) {
      parts.push({ type: typeQ as "BUYER" | "AGENT" | "GUARANTOR" | "PREVIOUS_OWNER" });
    }
    if (q) parts.push(buildPartnerSearchWhere(q));
    const where = parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : { AND: parts };
    const rows = await prisma.partner.findMany({
      orderBy: { createdAt: "desc" },
      include: partnerInclude
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

partnersRouter.get("/partners/:id", async (req, res, next) => {
  try {
    const row = await prisma.partner.findUnique({
      where: { id: req.params.id },
      include: partnerInclude
    });
    if (!row) return res.status(404).json({ error: "Partner not found" });
    res.json(serialize(row));
  } catch (e) {
    next(e);
  }
});

partnersRouter.post("/partners", async (req, res, next) => {
  try {
    const body = partnerCreate.parse(req.body);
    const data = buildCreateInput(body);
    const tenantCompanyId = getRequestContext()?.companyId;
    const tenantBranchId = getRequestContext()?.branchId ?? null;

    const withTenantConnect = tenantCompanyId
      ? (() => {
          const next: any = {
            ...data,
            company: { connect: { id: tenantCompanyId } },
            ...(tenantBranchId ? { branch: { connect: { id: tenantBranchId } } } : {})
          };
          const attachCompany = (row: any) => ({
            ...row,
            company: { connect: { id: tenantCompanyId } },
            ...(tenantBranchId ? { branch: { connect: { id: tenantBranchId } } } : {})
          });
          if (next.phones?.create) next.phones = { create: next.phones.create.map(attachCompany) };
          if (next.emails?.create) next.emails = { create: next.emails.create.map(attachCompany) };
          if (next.addresses?.create) next.addresses = { create: next.addresses.create.map(attachCompany) };
          if (next.documents?.create) next.documents = { create: next.documents.create.map(attachCompany) };
          return next;
        })()
      : data;
    const row = await prisma.partner.create({
      data: withTenantConnect,
      include: partnerInclude
    });
    await notifyAdminUsers({
      type: "PARTNER_CREATED",
      title: "Partner added",
      message: row.displayName,
      href: "/dashboard/autofinance/partners"
    });
    res.status(201).json(serialize(row));
  } catch (e) {
    next(e);
  }
});

partnersRouter.patch("/partners/:id", async (req, res, next) => {
  try {
    const body = partnerUpdate.parse(req.body);
    const id = req.params.id;
    const { phones, emails, addresses, documents } = body;
    const scalarUpdate = buildUpdateInput(body);

    const row = await prisma.$transaction(async (tx) => {
      if (Object.keys(scalarUpdate).length > 0) {
        await tx.partner.update({
          where: { id },
          data: scalarUpdate
        });
      }

      if (phones !== undefined) {
        await tx.partnerPhone.deleteMany({ where: { partnerId: id } });
        if (phones.length) {
          await tx.partnerPhone.createMany({
            data: phones.map((p) => ({
              id: randomUUID(),
              partnerId: id,
              phoneNumber: p.phoneNumber,
              phoneType: p.phoneType ?? "MOBILE",
              isPrimary: p.isPrimary ?? false,
              label: p.label ?? null
            }))
          });
        }
      }

      if (emails !== undefined) {
        await tx.partnerEmail.deleteMany({ where: { partnerId: id } });
        if (emails.length) {
          await tx.partnerEmail.createMany({
            data: emails.map((e) => ({
              id: randomUUID(),
              partnerId: id,
              email: e.email,
              emailType: e.emailType ?? "PERSONAL",
              isPrimary: e.isPrimary ?? false
            }))
          });
        }
      }

      if (addresses !== undefined) {
        await tx.partnerAddress.deleteMany({ where: { partnerId: id } });
        if (addresses.length) {
          await tx.partnerAddress.createMany({
            data: addresses.map((a) => ({
              id: randomUUID(),
              partnerId: id,
              addressType: a.addressType ?? "RESIDENTIAL",
              line1: a.line1,
              line2: a.line2 ?? null,
              city: a.city ?? null,
              stateRegion: a.stateRegion ?? null,
              postalCode: a.postalCode ?? null,
              country: a.country ?? null,
              isPrimary: a.isPrimary ?? false
            }))
          });
        }
      }

      if (documents !== undefined) {
        await tx.partnerDocument.deleteMany({ where: { partnerId: id } });
        if (documents.length) {
          await tx.partnerDocument.createMany({
            data: documents.map((d) => ({
              id: randomUUID(),
              partnerId: id,
              documentType: d.documentType,
              title: d.title ?? null,
              fileName: d.fileName ?? null,
              fileUrl: d.fileUrl ?? null,
              mimeType: d.mimeType ?? null,
              notes: d.notes ?? null,
              verifiedAt: d.verifiedAt ?? null
            }))
          });
        }
      }

      return tx.partner.findUniqueOrThrow({
        where: { id },
        include: partnerInclude
      });
    });

    await notifyAdminUsers({
      type: "PARTNER_UPDATED",
      title: "Partner updated",
      message: row.displayName,
      href: "/dashboard/autofinance/partners"
    });
    res.json(serialize(row));
  } catch (e) {
    next(e);
  }
});

partnersRouter.delete("/partners/:id", async (req, res, next) => {
  try {
    await prisma.partner.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2025") {
        res.status(404).json({ error: "Partner not found" });
        return;
      }
      if (e.code === "P2003" || e.code === "P2014") {
        res.status(409).json({
          error:
            "This partner cannot be deleted because it is linked to contracts or other records."
        });
        return;
      }
    }
    next(e);
  }
});

/** Staff-issued portal-access invite. No email/SMS delivery exists yet, so the caller is
 *  responsible for copying the returned link and sharing it with the partner directly. */
partnersRouter.post("/partners/:id/portal-invite", async (req, res, next) => {
  try {
    const ctx = getRequestContext();
    if (!ctx) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const partner = await prisma.partner.findUnique({
      where: { id: req.params.id },
      select: { id: true, companyId: true, type: true, email: true }
    });
    if (!partner) {
      res.status(404).json({ error: "Partner not found" });
      return;
    }
    if (partner.companyId !== ctx.companyId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (partner.type === "GUARANTOR") {
      res.status(400).json({ error: "Portal access is not available for guarantors." });
      return;
    }
    if (!partner.email) {
      res.status(400).json({ error: "This partner has no email on file — add one before inviting them." });
      return;
    }

    const rawToken = generateRefreshTokenRaw();
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    await prisma.partnerPortalInvite.create({
      data: {
        partnerId: partner.id,
        tokenHash: hashRefreshToken(rawToken),
        expiresAt
      }
    });

    const baseUrl = (process.env.PORTAL_BASE_URL ?? "https://localhost:3000").replace(/\/$/, "");
    res.status(201).json(
      serialize({
        inviteUrl: `${baseUrl}/dashboard/portal/invite/${rawToken}`,
        expiresAt
      })
    );
  } catch (e) {
    next(e);
  }
});
