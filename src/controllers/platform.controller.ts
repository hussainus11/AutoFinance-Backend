import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { getRequestContext } from "../context.js";

export const platformRouter = Router();

/** Only an ADMIN belonging to the platform-owner company (Auto Finance itself) may manage
 *  other companies. Not modeled via the regular RolePermission system — this is a tenant-type
 *  boundary, not a per-page permission, and must never be grantable to an ordinary tenant. */
async function requirePlatformOwnerAdmin(): Promise<{ ok: true; companyId: string } | { ok: false; status: number; error: string }> {
  const ctx = getRequestContext();
  if (!ctx) return { ok: false, status: 401, error: "Not authenticated" };
  if (ctx.role.toUpperCase() !== "ADMIN") return { ok: false, status: 403, error: "Forbidden" };
  const company = await (prisma as any).company.findUnique({
    where: { id: ctx.companyId },
    select: { isPlatformOwner: true }
  });
  if (!company?.isPlatformOwner) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true, companyId: ctx.companyId };
}

platformRouter.get("/platform/companies", async (_req, res, next) => {
  try {
    const auth = await requirePlatformOwnerAdmin();
    if (auth.ok === false) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }
    const rows = await (prisma as any).company.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { users: true } } }
    });
    res.json(
      serialize(
        rows.map((c: any) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          isActive: c.isActive,
          isPlatformOwner: c.isPlatformOwner,
          createdAt: c.createdAt,
          userCount: c._count.users
        }))
      )
    );
  } catch (e) {
    next(e);
  }
});

const updateBody = z.object({ isActive: z.boolean() }).strict();

platformRouter.patch("/platform/companies/:id", async (req, res, next) => {
  try {
    const auth = await requirePlatformOwnerAdmin();
    if (auth.ok === false) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }
    const body = updateBody.parse(req.body);
    const target = await (prisma as any).company.findUnique({ where: { id: req.params.id } });
    if (!target) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    if (target.isPlatformOwner) {
      res.status(400).json({ error: "The platform-owner company cannot be blocked." });
      return;
    }

    const updated = await (prisma as any).company.update({
      where: { id: req.params.id },
      data: { isActive: body.isActive }
    });

    if (!body.isActive) {
      // Cut off already-issued sessions immediately rather than waiting for access-token expiry.
      await (prisma as any).refreshToken.updateMany({
        where: { user: { companyId: req.params.id }, revokedAt: null },
        data: { revokedAt: new Date() }
      });
    }

    res.json(serialize(updated));
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    next(e);
  }
});
