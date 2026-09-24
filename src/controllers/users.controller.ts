import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { getRequestContext } from "../context.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { revokeAllSessionsForUser } from "../auth/session.js";

export const usersRouter = Router();

function buildUserSearchWhere(q: string): Prisma.UserWhereInput {
  const trimmed = q.trim();
  return {
    OR: [
      { email: { contains: trimmed, mode: "insensitive" } },
      { name: { contains: trimmed, mode: "insensitive" } },
      { role: { contains: trimmed, mode: "insensitive" } },
      { phone: { contains: trimmed, mode: "insensitive" } }
    ]
  };
}

/** Settings — user directory (basic CRUD). */
usersRouter.get("/users", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const rows = await (prisma as any).user.findMany({
      where: q ? buildUserSearchWhere(q) : undefined,
      orderBy: { createdAt: "desc" }
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

usersRouter.post("/users", async (req, res, next) => {
  try {
    const body = z
      .object({
        email: z.string().email(),
        name: z.string().optional().nullable(),
        phone: z.string().optional().nullable(),
        role: z.string().optional(),
        password: z.string().min(8).optional()
      })
      .parse(req.body);
    const row = await (prisma as any).user.create({
      data: {
        email: body.email,
        name: body.name ?? undefined,
        phone: body.phone ?? undefined,
        role: body.role ?? "USER",
        ...(body.password ? { passwordHash: hashPassword(body.password) } : {})
      }
    });
    res.status(201).json(serialize(row));
  } catch (e) {
    next(e);
  }
});

usersRouter.post("/users/:id/change-password", async (req, res, next) => {
  try {
    const body = z
      .object({
        password: z.string().min(8),
        currentPassword: z.string().optional()
      })
      .strict()
      .parse(req.body);
    const userId = req.params.id;
    const ctx = getRequestContext();
    if (!ctx) return res.status(401).json({ error: "Not authenticated" });

    const existing = await (prisma as any).user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true, passwordHash: true }
    });
    if (!existing) return res.status(404).json({ error: "User not found" });
    if (existing.companyId !== ctx.companyId) return res.status(403).json({ error: "Forbidden" });

    const isSelf = ctx.userId === userId;
    const isAdmin = ctx.role.toUpperCase() === "ADMIN";
    if (!isSelf && !isAdmin) return res.status(403).json({ error: "Forbidden" });

    if (isSelf && !isAdmin) {
      if (!body.currentPassword) {
        return res.status(400).json({ error: "currentPassword is required" });
      }
      if (!verifyPassword(body.currentPassword, existing.passwordHash)) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }
    }

    const row = await (prisma as any).user.update({
      where: { id: userId },
      data: { passwordHash: hashPassword(body.password) }
    });
    await revokeAllSessionsForUser(userId);
    res.json(serialize({ id: row.id }));
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    next(e);
  }
});

usersRouter.patch("/users/:id", async (req, res, next) => {
  try {
    const tenantCompanyId = getRequestContext()?.companyId ?? null;
    if (!tenantCompanyId) return res.status(400).json({ error: "Missing tenant" });
    const authedUserId = getRequestContext()?.userId ?? null;
    if (!authedUserId) return res.status(401).json({ error: "Missing user context" });

    const body = z
      .object({
        branchId: z.string().uuid().nullable().optional()
      })
      .strict()
      .parse(req.body);

    const actor = await (prisma as any).user.findUnique({
      where: { id: authedUserId },
      select: { id: true, companyId: true, role: true }
    });
    if (!actor) return res.status(401).json({ error: "User not found" });
    if (actor.companyId !== tenantCompanyId) return res.status(403).json({ error: "Forbidden" });
    if (String(actor.role) !== "ADMIN") return res.status(403).json({ error: "Admin only" });

    const userId = req.params.id;
    const existing = await (prisma as any).user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true }
    });
    if (!existing) return res.status(404).json({ error: "User not found" });
    if (existing.companyId !== tenantCompanyId) return res.status(403).json({ error: "Forbidden" });

    let branchId: string | null | undefined = undefined;
    if (body.branchId !== undefined) {
      if (body.branchId === null) {
        branchId = null;
      } else {
        const b = await (prisma as any).branch.findUnique({
          where: { id: body.branchId },
          select: { id: true, companyId: true }
        });
        if (!b) return res.status(400).json({ error: "Invalid branchId" });
        if (b.companyId !== tenantCompanyId) return res.status(403).json({ error: "Forbidden" });
        branchId = b.id;
      }
    }

    const updated = await (prisma as any).user.update({
      where: { id: userId },
      data: {
        ...(branchId !== undefined ? { branchId } : {})
      },
      select: { id: true, email: true, name: true, role: true, branchId: true }
    });
    res.json(serialize(updated));
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    next(e);
  }
});

/** Logged-in user profile (name/phone/avatar). */
usersRouter.patch("/users/me", async (req, res, next) => {
  try {
    const tenantCompanyId = getRequestContext()?.companyId ?? null;
    if (!tenantCompanyId) return res.status(400).json({ error: "Missing tenant" });
    const authedUserId = getRequestContext()?.userId ?? null;
    if (!authedUserId) return res.status(401).json({ error: "Missing user context" });

    const body = z
      .object({
        name: z.string().optional().nullable(),
        phone: z.string().optional().nullable(),
        avatarUrl: z.string().url().optional().nullable()
      })
      .strict()
      .parse(req.body);

    const existing = await (prisma as any).user.findUnique({
      where: { id: authedUserId },
      select: { id: true, companyId: true, email: true, role: true }
    });
    if (!existing) return res.status(404).json({ error: "User not found" });
    if (existing.companyId !== tenantCompanyId) return res.status(403).json({ error: "Forbidden" });

    const updated = await (prisma as any).user.update({
      where: { id: authedUserId },
      data: {
        ...(body.name !== undefined ? { name: body.name ? body.name.trim() : null } : {}),
        ...(body.phone !== undefined ? { phone: body.phone ? body.phone.trim() : null } : {}),
        ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl ? body.avatarUrl.trim() : null } : {})
      },
      select: { id: true, email: true, name: true, phone: true, avatarUrl: true, role: true }
    });

    res.json(serialize(updated));
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    next(e);
  }
});

usersRouter.delete("/users/:id", async (req, res, next) => {
  try {
    const userId = req.params.id;
    const tenantCompanyId = getRequestContext()?.companyId ?? null;
    if (!tenantCompanyId) return res.status(400).json({ error: "Missing tenant" });

    const existing = await (prisma as any).user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true }
    });
    if (!existing) return res.status(404).json({ error: "User not found" });
    if (existing.companyId !== tenantCompanyId) return res.status(403).json({ error: "Forbidden" });

    await (prisma as any).user.delete({ where: { id: userId } });
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});
