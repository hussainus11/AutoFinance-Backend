import crypto from "node:crypto";
import jwt from "jsonwebtoken";

// Staff and partner tokens share one JWT_SECRET, so an explicit `aud` claim keeps them
// cryptographically non-interchangeable — a staff token can never verify as a partner token
// or vice versa, even though the signing key is the same.

export type StaffAccessTokenClaims = {
  sub: string;
  companyId: string;
  branchId: string | null;
  role: string;
  roleId: string | null;
  name: string | null;
};

export type PartnerAccessTokenClaims = {
  sub: string; // Partner.id
  companyId: string;
  branchId: string | null;
  partnerType: string; // BUYER | AGENT | PREVIOUS_OWNER (GUARANTOR is never issued a token)
  name: string | null;
};

function getJwtSecret(): string {
  const raw = (process.env.JWT_SECRET ?? "").trim();
  if (!raw) throw new Error("Missing JWT_SECRET (required to sign auth tokens).");
  return raw;
}

function getAccessTokenTtl(): string {
  return (process.env.ACCESS_TOKEN_TTL ?? "15m").trim();
}

export function signStaffAccessToken(claims: StaffAccessTokenClaims): string {
  const { sub, ...rest } = claims;
  return jwt.sign({ ...rest, aud: "staff" }, getJwtSecret(), {
    subject: sub,
    expiresIn: getAccessTokenTtl() as jwt.SignOptions["expiresIn"]
  });
}

/** Throws if the token is missing, malformed, expired, has an invalid signature, or was
 *  issued for a different audience (e.g. a partner token presented here). */
export function verifyStaffAccessToken(token: string): StaffAccessTokenClaims {
  const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
  if (decoded.aud !== "staff" || !decoded.sub || !decoded.companyId || !decoded.role) {
    throw new Error("Invalid token: not a staff token or missing required claims");
  }
  return {
    sub: decoded.sub,
    companyId: String(decoded.companyId),
    branchId: decoded.branchId != null ? String(decoded.branchId) : null,
    role: String(decoded.role),
    roleId: decoded.roleId != null ? String(decoded.roleId) : null,
    name: decoded.name != null ? String(decoded.name) : null
  };
}

export function signPartnerAccessToken(claims: PartnerAccessTokenClaims): string {
  const { sub, ...rest } = claims;
  return jwt.sign({ ...rest, aud: "partner" }, getJwtSecret(), {
    subject: sub,
    expiresIn: getAccessTokenTtl() as jwt.SignOptions["expiresIn"]
  });
}

/** Throws if the token is missing, malformed, expired, has an invalid signature, or was
 *  issued for a different audience (e.g. a staff token presented here). */
export function verifyPartnerAccessToken(token: string): PartnerAccessTokenClaims {
  const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
  if (decoded.aud !== "partner" || !decoded.sub || !decoded.companyId || !decoded.partnerType) {
    throw new Error("Invalid token: not a partner token or missing required claims");
  }
  return {
    sub: decoded.sub,
    companyId: String(decoded.companyId),
    branchId: decoded.branchId != null ? String(decoded.branchId) : null,
    partnerType: String(decoded.partnerType),
    name: decoded.name != null ? String(decoded.name) : null
  };
}

export function generateRefreshTokenRaw(): string {
  return crypto.randomBytes(48).toString("base64url");
}

export function hashRefreshToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
