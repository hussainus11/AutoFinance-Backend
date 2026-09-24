import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";

export const rolesRouter = Router();

function ensureRolesAvailable(res: { status: (c: number) => any; json: (v: any) => any }): boolean {
  const p = prisma as unknown as { role?: unknown; rolePermission?: unknown };
  if (typeof p.role === "undefined" || typeof p.rolePermission === "undefined") {
    res.status(500).json({
      error:
        "Prisma client is out of date (Role/RolePermission model missing). Stop the API, run `npm run db:deploy`, then `npx prisma generate`, then restart."
    });
    return false;
  }
  return true;
}

rolesRouter.get("/roles", async (_req, res, next) => {
  try {
    if (!ensureRolesAvailable(res)) return;
    const rows = await (prisma as any).role.findMany({ orderBy: { name: "asc" } });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

rolesRouter.get("/roles/:id", async (req, res, next) => {
  try {
    if (!ensureRolesAvailable(res)) return;
    const id = req.params.id;
    const row = await (prisma as any).role.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "Role not found" });
    res.json(serialize(row));
  } catch (e) {
    next(e);
  }
});

rolesRouter.patch("/roles/:id", async (req, res, next) => {
  try {
    if (!ensureRolesAvailable(res)) return;
    const id = req.params.id;
    const body = z
      .object({
        name: z.string().min(2).optional(),
        description: z.string().optional().nullable(),
        isActive: z.boolean().optional()
      })
      .strict()
      .parse(req.body);
    const row = await (prisma as any).role.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description ?? undefined } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {})
      }
    });
    res.json(serialize(row));
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    const maybePrisma = e as { code?: string };
    if (maybePrisma?.code === "P2002") {
      res.status(409).json({ error: "Role name already exists." });
      return;
    }
    next(e);
  }
});

rolesRouter.get("/roles/by-name/:name", async (req, res, next) => {
  try {
    if (!ensureRolesAvailable(res)) return;
    const name = String(req.params.name ?? "").trim();
    const role = await (prisma as any).role.findFirst({
      where: { name },
      include: { permissions: true }
    });
    if (!role) return res.status(404).json({ error: "Role not found" });
    const keys = (role.permissions ?? []).map((p: any) => p.key);
    res.json(serialize({ role, permissionKeys: keys }));
  } catch (e) {
    next(e);
  }
});

rolesRouter.get("/roles/:id/permissions", async (req, res, next) => {
  try {
    if (!ensureRolesAvailable(res)) return;
    const id = req.params.id;
    const rows = await (prisma as any).rolePermission.findMany({
      where: { roleId: id },
      orderBy: { key: "asc" }
    });
    res.json(serialize(rows.map((r: any) => r.key)));
  } catch (e) {
    next(e);
  }
});

rolesRouter.put("/roles/:id/permissions", async (req, res, next) => {
  try {
    if (!ensureRolesAvailable(res)) return;
    const id = req.params.id;
    const body = z
      .object({
        keys: z.array(z.string().min(1))
      })
      .strict()
      .parse(req.body);

    const uniqueKeys = Array.from(new Set(body.keys.map((k) => k.trim()).filter(Boolean)));
    await (prisma as any).$transaction(async (tx: any) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      for (const key of uniqueKeys) {
        await tx.rolePermission.create({
          data: {
            key,
            role: { connect: { id } }
          }
        });
      }
    });
    res.json(serialize({ roleId: id, keys: uniqueKeys }));
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    next(e);
  }
});

rolesRouter.post("/roles", async (req, res, next) => {
  try {
    if (!ensureRolesAvailable(res)) return;
    const body = z
      .object({
        name: z.string().min(2),
        description: z.string().optional().nullable(),
        isActive: z.boolean().optional()
      })
      .strict()
      .parse(req.body);

    const row = await (prisma as any).role.create({
      data: {
        name: body.name.trim(),
        description: body.description ?? undefined,
        isActive: body.isActive ?? true
      }
    });
    res.status(201).json(serialize(row));
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    const maybePrisma = e as { code?: string };
    if (maybePrisma?.code === "P2002") {
      res.status(409).json({ error: "Role name already exists." });
      return;
    }
    next(e);
  }
});

rolesRouter.delete("/roles/:id", async (req, res, next) => {
  try {
    if (!ensureRolesAvailable(res)) return;
    const id = req.params.id;
    const existing = await (prisma as any).role.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: "Role not found" });
    await (prisma as any).role.delete({ where: { id } });
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

