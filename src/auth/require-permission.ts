import type { NextFunction, Request, RequestHandler, Response } from "express";
import { prisma } from "../prisma.js";
import { getRequestContext } from "../context.js";
import { permissionKeyForPath } from "./route-permissions.js";

async function roleHasPermission(roleId: string, key: string): Promise<boolean> {
  const row = await (prisma as any).rolePermission.findUnique({
    where: { roleId_key: { roleId, key } }
  });
  return Boolean(row);
}

/** ADMIN bypasses all checks. A user with no roleId assigned is unrestricted (transitional
 *  default — strictly no worse than today's behavior, where nothing is enforced for anyone). */
export function requirePermission(key: string): RequestHandler {
  return async (_req, res, next) => {
    const ctx = getRequestContext();
    if (!ctx) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (ctx.role.toUpperCase() === "ADMIN") {
      next();
      return;
    }
    if (!ctx.roleId) {
      next();
      return;
    }
    try {
      const ok = await roleHasPermission(ctx.roleId, key);
      if (!ok) {
        res.status(403).json({ error: "Forbidden: missing permission", key });
        return;
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Used as global apiRouter middleware: looks up the permission key for the current path
 *  (via ROUTE_PERMISSIONS) and delegates to requirePermission, or passes through untouched
 *  if the path isn't gated by any permission key. */
export function requirePermissionForPath(req: Request, res: Response, next: NextFunction): void {
  const key = permissionKeyForPath(req.path);
  if (!key) {
    next();
    return;
  }
  requirePermission(key)(req, res, next);
}
