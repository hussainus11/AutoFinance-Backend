import crypto from "node:crypto";
import { prisma } from "../prisma.js";
import {
  signPartnerAccessToken,
  generateRefreshTokenRaw,
  hashRefreshToken,
  type PartnerAccessTokenClaims
} from "../auth/jwt.js";

function getRefreshTtlDays(): number {
  const raw = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? "7");
  return Number.isFinite(raw) && raw > 0 ? raw : 7;
}

async function loadClaims(partnerId: string): Promise<PartnerAccessTokenClaims | null> {
  const partner = await (prisma as any).partner.findUnique({
    where: { id: partnerId },
    select: { id: true, companyId: true, branchId: true, type: true, displayName: true }
  });
  if (!partner || !partner.companyId) return null;
  // Defense in depth: portal access is never valid for GUARANTOR partners, regardless of
  // how a passwordHash might have ended up set on one.
  if (partner.type === "GUARANTOR") return null;
  return {
    sub: partner.id,
    companyId: partner.companyId,
    branchId: partner.branchId ?? null,
    partnerType: partner.type,
    name: partner.displayName ?? null
  };
}

export type IssuedPortalSession = { accessToken: string; refreshTokenRaw: string; refreshExpiresAt: Date };

export async function issuePortalSession(partnerId: string): Promise<IssuedPortalSession> {
  const claims = await loadClaims(partnerId);
  if (!claims) throw new Error("Cannot issue portal session: partner not found, has no company, or is a guarantor");

  const accessToken = signPartnerAccessToken(claims);
  const refreshTokenRaw = generateRefreshTokenRaw();
  const refreshExpiresAt = new Date(Date.now() + getRefreshTtlDays() * 86_400_000);
  const id = crypto.randomUUID();

  await (prisma as any).partnerRefreshToken.create({
    data: {
      id,
      partnerId,
      tokenHash: hashRefreshToken(refreshTokenRaw),
      familyId: id,
      expiresAt: refreshExpiresAt
    }
  });

  return { accessToken, refreshTokenRaw, refreshExpiresAt };
}

export type RotatePortalResult =
  | { ok: true; accessToken: string; refreshTokenRaw: string; refreshExpiresAt: Date }
  | { ok: false; reason: "invalid" | "expired" | "reused" };

/** Same rotation-with-reuse-detection semantics as the staff session module: presenting an
 *  already-revoked refresh token revokes the entire rotation family, not just that token. */
export async function rotatePortalSession(refreshTokenRaw: string): Promise<RotatePortalResult> {
  const tokenHash = hashRefreshToken(refreshTokenRaw);
  const existing = await (prisma as any).partnerRefreshToken.findUnique({ where: { tokenHash } });
  if (!existing) return { ok: false, reason: "invalid" };

  if (existing.revokedAt) {
    await (prisma as any).partnerRefreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    return { ok: false, reason: "reused" };
  }

  if (existing.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  const claims = await loadClaims(existing.partnerId);
  if (!claims) return { ok: false, reason: "invalid" };

  const newRefreshRaw = generateRefreshTokenRaw();
  const refreshExpiresAt = new Date(Date.now() + getRefreshTtlDays() * 86_400_000);
  const newId = crypto.randomUUID();

  await prisma.$transaction(async (tx) => {
    await (tx as any).partnerRefreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedByTokenId: newId }
    });
    await (tx as any).partnerRefreshToken.create({
      data: {
        id: newId,
        partnerId: existing.partnerId,
        tokenHash: hashRefreshToken(newRefreshRaw),
        familyId: existing.familyId,
        expiresAt: refreshExpiresAt
      }
    });
  });

  const accessToken = signPartnerAccessToken(claims);
  return { ok: true, accessToken, refreshTokenRaw: newRefreshRaw, refreshExpiresAt };
}

export async function revokePortalSession(refreshTokenRaw: string): Promise<void> {
  const tokenHash = hashRefreshToken(refreshTokenRaw);
  await (prisma as any).partnerRefreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() }
  });
}

export async function revokeAllPortalSessionsForPartner(partnerId: string): Promise<void> {
  await (prisma as any).partnerRefreshToken.updateMany({
    where: { partnerId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
}
