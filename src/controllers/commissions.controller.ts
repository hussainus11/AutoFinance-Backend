import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { postCommissionPaidJournalEntry } from "../services/accounting-posting.js";
import { connectById, tenantConnectOrThrow } from "../services/tenant-helpers.js";

export const commissionsRouter = Router();

const commissionCreate = z.object({
  contractId: z.string().uuid(),
  agentId: z.string().uuid(),
  amount: z.string().or(z.number()),
  status: z.enum(["PENDING", "PAID"]).optional()
});

/** Commissions page — agent payouts. */
commissionsRouter.get("/commissions", async (_req, res, next) => {
  try {
    const rows = await prisma.commission.findMany({
      include: { agent: true, contract: true },
      orderBy: { createdAt: "desc" }
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

commissionsRouter.post("/commissions", async (req, res, next) => {
  try {
    const body = commissionCreate.parse(req.body);
    const tenant = tenantConnectOrThrow();
    const row = await prisma.commission.create({
      data: {
        ...tenant,
        contract: connectById(body.contractId),
        agent: connectById(body.agentId),
        amount: new Prisma.Decimal(String(body.amount)),
        status: body.status ?? "PENDING"
      }
    });
    res.status(201).json(serialize(row));
  } catch (e) {
    next(e);
  }
});

commissionsRouter.patch("/commissions/:id", async (req, res, next) => {
  try {
    const body = z
      .object({
        status: z.enum(["PENDING", "PAID"]).optional(),
        paidAt: z.string().datetime().nullable().optional()
      })
      .parse(req.body);
    const before = await prisma.commission.findUnique({ where: { id: req.params.id }, select: { status: true } });
    const row = await prisma.commission.update({
      where: { id: req.params.id },
      data: {
        status: body.status,
        paidAt: body.paidAt === null ? null : body.paidAt ? new Date(body.paidAt) : undefined
      }
    });
    if ((before?.status ?? "PENDING") !== "PAID" && row.status === "PAID") {
      try {
        await postCommissionPaidJournalEntry(row.id);
      } catch {
        // Accounting optional until configured
      }
    }
    res.json(serialize(row));
  } catch (e) {
    next(e);
  }
});
