import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";

export const vehicleTypesRouter = Router();

const vehicleTypeCreate = z.object({
  name: z.string().min(1),
  isActive: z.boolean().optional()
});

/** Vehicle Types — setup master data used when creating/editing a vehicle. */
vehicleTypesRouter.get("/vehicle-types", async (_req, res, next) => {
  try {
    const rows = await (prisma as any).vehicleType.findMany({ orderBy: { name: "asc" } });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

vehicleTypesRouter.post("/vehicle-types", async (req, res, next) => {
  try {
    const body = vehicleTypeCreate.parse(req.body);
    const row = await (prisma as any).vehicleType.create({
      data: { name: body.name.trim(), isActive: body.isActive ?? true }
    });
    res.status(201).json(serialize(row));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      res.status(409).json({ error: "A vehicle type with this name already exists." });
      return;
    }
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    next(e);
  }
});

vehicleTypesRouter.patch("/vehicle-types/:id", async (req, res, next) => {
  try {
    const body = vehicleTypeCreate.partial().parse(req.body);
    const row = await (prisma as any).vehicleType.update({
      where: { id: req.params.id },
      data: {
        name: body.name ? body.name.trim() : undefined,
        isActive: typeof body.isActive === "boolean" ? body.isActive : undefined
      }
    });
    res.json(serialize(row));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") {
        res.status(409).json({ error: "A vehicle type with this name already exists." });
        return;
      }
      if (e.code === "P2025") {
        res.status(404).json({ error: "Vehicle type not found" });
        return;
      }
    }
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    next(e);
  }
});

vehicleTypesRouter.delete("/vehicle-types/:id", async (req, res, next) => {
  try {
    await (prisma as any).vehicleType.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2025") {
        res.status(404).json({ error: "Vehicle type not found" });
        return;
      }
      if (e.code === "P2003" || e.code === "P2014") {
        res.status(409).json({
          error: "This vehicle type cannot be deleted because it is used by one or more vehicles."
        });
        return;
      }
    }
    next(e);
  }
});
