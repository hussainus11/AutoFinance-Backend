import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";

export const installmentsRouter = Router();

/** Installments page — EMI rows (optional filter by contract). */
installmentsRouter.get("/installments", async (req, res, next) => {
  try {
    const q = req.query.contractId;
    const contractId =
      typeof q === "string" && q.length > 0 ? z.string().uuid().parse(q) : undefined;
    const rows = await prisma.installment.findMany({
      where: contractId ? { contractId } : undefined,
      include: { contract: { include: { buyer: true } } },
      orderBy: [{ contractId: "asc" }, { sequence: "asc" }]
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});
