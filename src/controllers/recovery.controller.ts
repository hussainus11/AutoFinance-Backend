import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { getRequestContext } from "../context.js";

export const recoveryRouter = Router();

const CFG_RECOVERY_PREFIX = "numbering.recoveryCase.prefix";
const CFG_RECOVERY_NEXT = "numbering.recoveryCase.next";

function pad4(n: number) {
  return String(n).padStart(4, "0");
}

async function nextRecoveryCaseNumber(tx: any, companyId: string): Promise<string> {
  const prefixRows = (await tx.$queryRawUnsafe(
    `SELECT "value" FROM "SystemConfig" WHERE "companyId" = $1 AND "key" = $2 LIMIT 1`,
    companyId,
    CFG_RECOVERY_PREFIX
  )) as Array<{ value: string }>;
  const prefix = (prefixRows?.[0]?.value ?? "RC-").trim() || "RC-";

  const nextRows = (await tx.$queryRawUnsafe(
    `SELECT "value" FROM "SystemConfig" WHERE "companyId" = $1 AND "key" = $2 FOR UPDATE`,
    companyId,
    CFG_RECOVERY_NEXT
  )) as Array<{ value: string }>;
  const current = Number(String(nextRows?.[0]?.value ?? "1").replace(/,/g, "").trim());
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
    CFG_RECOVERY_NEXT,
    String(n + 1)
  );

  return `${prefix}${pad4(n)}`;
}

function recoveryInclude() {
  return {
    assignedTo: { select: { id: true, email: true, name: true } },
    contract: { include: { buyer: true, vehicles: { include: { vehicle: true } } } }
  } as const;
}

/** Collections / recovery — cases linked to contracts. */
recoveryRouter.get("/recovery", async (_req, res, next) => {
  try {
    const rows = await prisma.recoveryCase.findMany({
      include: recoveryInclude() as any,
      orderBy: { openedAt: "desc" }
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

recoveryRouter.post("/recovery", async (req, res, next) => {
  try {
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId ?? null;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });

    const body = z
      .object({
        contractId: z.string().uuid(),
        notes: z.string().optional().nullable(),
        assignedToUserId: z.string().uuid().optional().nullable()
      })
      .parse(req.body);

    const row = await prisma.$transaction(async (tx: any) => {
      const caseNumber = await nextRecoveryCaseNumber(tx, companyId);
      const created = await tx.recoveryCase.create({
        data: {
          contract: { connect: { id: body.contractId } },
          notes: body.notes ?? undefined,
          caseNumber,
          assignedToUserId: body.assignedToUserId ?? undefined,
          company: { connect: { id: companyId } },
          ...(branchId ? { branch: { connect: { id: branchId } } } : {})
        } as any,
        include: recoveryInclude() as any
      });
      await tx.recoveryCaseEvent.create({
        data: {
          case: { connect: { id: created.id } },
          type: "CASE_OPENED",
          note: body.notes ?? undefined,
          company: { connect: { id: companyId } },
          ...(branchId ? { branch: { connect: { id: branchId } } } : {})
        } as any
      });
      return created;
    });

    res.status(201).json(serialize(row));
  } catch (e) {
    next(e);
  }
});

recoveryRouter.get("/recovery/:id", async (req, res, next) => {
  try {
    const row = await prisma.recoveryCase.findUnique({
      where: { id: req.params.id },
      include: {
        ...recoveryInclude(),
        events: { orderBy: { createdAt: "asc" } },
        fees: { orderBy: { createdAt: "asc" } },
        attachments: { orderBy: { createdAt: "asc" } },
        taskRequests: { orderBy: { createdAt: "desc" }, take: 25, include: { assignedTo: { select: { id: true, email: true, name: true } } } }
      } as any
    });
    if (!row) return res.status(404).json({ error: "Recovery case not found" });
    res.json(serialize(row));
  } catch (e) {
    next(e);
  }
});

recoveryRouter.patch("/recovery/:id", async (req, res, next) => {
  try {
    const body = z
      .object({
        notes: z.string().optional().nullable(),
        assignedToUserId: z.string().uuid().optional().nullable(),
        status: z
          .enum([
            "OPEN",
            "IN_PROGRESS",
            "REPO_REQUESTED",
            "REPO_APPROVED",
            "REPOSSESSED",
            "DISPOSAL_REQUESTED",
            "DISPOSAL_APPROVED",
            "DISPOSED",
            "SETTLED",
            "CLOSED",
            "CANCELLED",
            "RESOLVED"
          ])
          .optional()
      })
      .strict()
      .parse(req.body);

    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId ?? null;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });

    const updated = await prisma.$transaction(async (tx: any) => {
      const current = await tx.recoveryCase.findUnique({ where: { id: req.params.id } });
      if (!current) throw new Error("Recovery case not found");

      const row = await tx.recoveryCase.update({
        where: { id: req.params.id },
        data: {
          ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
          ...(body.assignedToUserId !== undefined ? { assignedToUserId: body.assignedToUserId ?? null } : {}),
          ...(body.status !== undefined ? { status: body.status as any } : {})
        } as any,
        include: recoveryInclude() as any
      });

      // Keep Contract status aligned with terminal recovery states.
      if (body.status === "REPOSSESSED") {
        await tx.contract.update({
          where: { id: current.contractId },
          data: { status: "REPOSSESSED" }
        });
      }
      if (body.status === "CLOSED") {
        await tx.contract.update({
          where: { id: current.contractId },
          data: { status: "CLOSED" }
        });
      }

      await tx.recoveryCaseEvent.create({
        data: {
          case: { connect: { id: row.id } },
          type: "CASE_UPDATED",
          note: body.notes ?? undefined,
          company: { connect: { id: companyId } },
          ...(branchId ? { branch: { connect: { id: branchId } } } : {})
        } as any
      });

      return row;
    });

    res.json(serialize(updated));
  } catch (e) {
    if (e instanceof Error && e.message === "Recovery case not found") {
      res.status(404).json({ error: e.message });
      return;
    }
    next(e);
  }
});

recoveryRouter.post("/recovery/:id/fees", async (req, res, next) => {
  try {
    const body = z.object({ label: z.string().min(1), amount: z.string().or(z.number()) }).parse(req.body);
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId ?? null;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });

    const out = await prisma.$transaction(async (tx: any) => {
      const c = await tx.recoveryCase.findUnique({ where: { id: req.params.id } });
      if (!c) throw new Error("Recovery case not found");
      const fee = await tx.recoveryFee.create({
        data: {
          case: { connect: { id: c.id } },
          label: body.label.trim(),
          amount: new Prisma.Decimal(String(body.amount)),
          company: { connect: { id: companyId } },
          ...(branchId ? { branch: { connect: { id: branchId } } } : {})
        } as any
      });
      const sum = await tx.recoveryFee.aggregate({ where: { caseId: c.id }, _sum: { amount: true } });
      await tx.recoveryCase.update({
        where: { id: c.id },
        data: { recoveryFeesTotal: sum._sum.amount ?? 0 } as any
      });
      await tx.recoveryCaseEvent.create({
        data: {
          case: { connect: { id: c.id } },
          type: "FEE_ADDED",
          note: `${body.label}: ${body.amount}`,
          company: { connect: { id: companyId } },
          ...(branchId ? { branch: { connect: { id: branchId } } } : {})
        } as any
      });
      return fee;
    });

    res.status(201).json(serialize(out));
  } catch (e) {
    if (e instanceof Error && e.message === "Recovery case not found") {
      res.status(404).json({ error: e.message });
      return;
    }
    next(e);
  }
});

recoveryRouter.post("/recovery/:id/request-repossession", async (req, res, next) => {
  try {
    const body = z
      .object({
        repoLocation: z.string().optional().nullable(),
        repoOfficerName: z.string().optional().nullable(),
        repoNotes: z.string().optional().nullable()
      })
      .parse(req.body);
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId ?? null;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });

    const out = await prisma.$transaction(async (tx: any) => {
      const c = await tx.recoveryCase.findUnique({ where: { id: req.params.id } });
      if (!c) throw new Error("Recovery case not found");

      const updated = await tx.recoveryCase.update({
        where: { id: c.id },
        data: {
          status: "REPO_REQUESTED",
          repoRequestedAt: new Date(),
          repoLocation: body.repoLocation ?? undefined,
          repoOfficerName: body.repoOfficerName ?? undefined,
          repoNotes: body.repoNotes ?? undefined
        } as any
      });

      const task = await tx.taskQueueRequest.create({
        data: {
          contract: { connect: { id: updated.contractId } },
          requestType: "RECOVERY_REPOSSESS",
          recoveryCase: { connect: { id: updated.id } },
          status: "DRAFT",
          title: `Repossession: ${updated.caseNumber ?? updated.id.slice(0, 8)}`,
          company: { connect: { id: companyId } },
          ...(branchId ? { branch: { connect: { id: branchId } } } : {})
        } as any
      });

      await tx.recoveryCaseEvent.create({
        data: {
          case: { connect: { id: updated.id } },
          type: "REPO_REQUESTED",
          note: body.repoNotes ?? undefined,
          company: { connect: { id: companyId } },
          ...(branchId ? { branch: { connect: { id: branchId } } } : {})
        } as any
      });

      return { case: updated, task };
    });

    res.json(serialize(out));
  } catch (e) {
    if (e instanceof Error && e.message === "Recovery case not found") {
      res.status(404).json({ error: e.message });
      return;
    }
    next(e);
  }
});

recoveryRouter.post("/recovery/:id/request-disposal", async (req, res, next) => {
  try {
    const body = z
      .object({
        disposalMethod: z.enum(["AUCTION", "DIRECT_SALE", "RETURN_TO_DEALER", "OTHER"]),
        salePrice: z.string().or(z.number()).optional().nullable(),
        buyerName: z.string().optional().nullable(),
        buyerContact: z.string().optional().nullable(),
        disposalNotes: z.string().optional().nullable()
      })
      .parse(req.body);
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId ?? null;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });

    const out = await prisma.$transaction(async (tx: any) => {
      const c = await tx.recoveryCase.findUnique({ where: { id: req.params.id } });
      if (!c) throw new Error("Recovery case not found");

      const updated = await tx.recoveryCase.update({
        where: { id: c.id },
        data: {
          status: "DISPOSAL_REQUESTED",
          disposalMethod: body.disposalMethod,
          salePrice: body.salePrice != null && body.salePrice !== "" ? new Prisma.Decimal(String(body.salePrice)) : undefined,
          disposalBuyerName: body.buyerName ?? undefined,
          disposalBuyerContact: body.buyerContact ?? undefined,
          disposalNotes: body.disposalNotes ?? undefined
        } as any
      });

      const task = await tx.taskQueueRequest.create({
        data: {
          contract: { connect: { id: updated.contractId } },
          requestType: "RECOVERY_DISPOSE",
          recoveryCase: { connect: { id: updated.id } },
          status: "DRAFT",
          title: `Dispose: ${updated.caseNumber ?? updated.id.slice(0, 8)}`,
          company: { connect: { id: companyId } },
          ...(branchId ? { branch: { connect: { id: branchId } } } : {})
        } as any
      });

      await tx.recoveryCaseEvent.create({
        data: {
          case: { connect: { id: updated.id } },
          type: "DISPOSAL_REQUESTED",
          note: body.disposalNotes ?? undefined,
          company: { connect: { id: companyId } },
          ...(branchId ? { branch: { connect: { id: branchId } } } : {})
        } as any
      });

      return { case: updated, task };
    });

    res.json(serialize(out));
  } catch (e) {
    if (e instanceof Error && e.message === "Recovery case not found") {
      res.status(404).json({ error: e.message });
      return;
    }
    next(e);
  }
});

recoveryRouter.post("/recovery/:id/attachments", async (req, res, next) => {
  try {
    const body = z
      .object({
        fileUrl: z.string().url(),
        fileName: z.string().optional().nullable(),
        mimeType: z.string().optional().nullable()
      })
      .parse(req.body);
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId ?? null;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });

    const out = await prisma.$transaction(async (tx: any) => {
      const c = await tx.recoveryCase.findUnique({ where: { id: req.params.id } });
      if (!c) throw new Error("Recovery case not found");
      const a = await tx.recoveryCaseAttachment.create({
        data: {
          case: { connect: { id: c.id } },
          fileUrl: body.fileUrl,
          fileName: body.fileName ?? undefined,
          mimeType: body.mimeType ?? undefined,
          company: { connect: { id: companyId } },
          ...(branchId ? { branch: { connect: { id: branchId } } } : {})
        } as any
      });
      await tx.recoveryCaseEvent.create({
        data: {
          case: { connect: { id: c.id } },
          type: "ATTACHMENT_ADDED",
          note: body.fileName ?? undefined,
          company: { connect: { id: companyId } },
          ...(branchId ? { branch: { connect: { id: branchId } } } : {})
        } as any
      });
      return a;
    });

    res.status(201).json(serialize(out));
  } catch (e) {
    if (e instanceof Error && e.message === "Recovery case not found") {
      res.status(404).json({ error: e.message });
      return;
    }
    next(e);
  }
});

recoveryRouter.post("/recovery/:id/request-close", async (req, res, next) => {
  try {
    const body = z.object({ note: z.string().optional().nullable() }).parse(req.body);
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId ?? null;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });

    const out = await prisma.$transaction(async (tx: any) => {
      const c = await tx.recoveryCase.findUnique({ where: { id: req.params.id } });
      if (!c) throw new Error("Recovery case not found");

      const updated = await tx.recoveryCase.update({
        where: { id: c.id },
        data: { status: "SETTLED" } as any
      });

      const task = await tx.taskQueueRequest.create({
        data: {
          contract: { connect: { id: updated.contractId } },
          requestType: "RECOVERY_CLOSE",
          recoveryCase: { connect: { id: updated.id } },
          status: "DRAFT",
          title: `Close: ${updated.caseNumber ?? updated.id.slice(0, 8)}`,
          notes: body.note ?? undefined,
          company: { connect: { id: companyId } },
          ...(branchId ? { branch: { connect: { id: branchId } } } : {})
        } as any
      });

      await tx.recoveryCaseEvent.create({
        data: {
          case: { connect: { id: updated.id } },
          type: "CLOSE_REQUESTED",
          note: body.note ?? undefined,
          company: { connect: { id: companyId } },
          ...(branchId ? { branch: { connect: { id: branchId } } } : {})
        } as any
      });

      return { case: updated, task };
    });

    res.json(serialize(out));
  } catch (e) {
    if (e instanceof Error && e.message === "Recovery case not found") {
      res.status(404).json({ error: e.message });
      return;
    }
    next(e);
  }
});
