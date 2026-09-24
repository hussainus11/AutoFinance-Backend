import type { NextFunction, Request, Response } from "express";
import { readPortalAccessToken } from "./cookies.js";
import { verifyPartnerAccessToken } from "../auth/jwt.js";
import { runWithPortalContext } from "../portal-context.js";

export function requirePortalAuth(req: Request, res: Response, next: NextFunction): void {
  const token = readPortalAccessToken(req);
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  let claims;
  try {
    claims = verifyPartnerAccessToken(token);
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  runWithPortalContext(
    {
      companyId: claims.companyId,
      branchId: claims.branchId,
      partnerId: claims.sub,
      partnerType: claims.partnerType,
      partnerName: claims.name
    },
    () => next()
  );
}
