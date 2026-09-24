import type { NextFunction, Request, Response } from "express";
import { readAccessToken } from "./cookies.js";
import { verifyStaffAccessToken } from "./jwt.js";
import { runWithContext } from "../context.js";

/** Verifies the access token (cookie or Authorization header) and runs the rest of the
 *  request inside an AsyncLocalStorage-scoped RequestContext derived from its claims. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = readAccessToken(req);
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  let claims;
  try {
    claims = verifyStaffAccessToken(token);
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  runWithContext(
    {
      companyId: claims.companyId,
      branchId: claims.branchId,
      userId: claims.sub,
      userName: claims.name,
      role: claims.role,
      roleId: claims.roleId
    },
    () => next()
  );
}
