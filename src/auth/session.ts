import crypto from "node:crypto";
import { prisma } from "../prisma.js";
import { signStaffAccessToken, generateRefreshTokenRaw, hashRefreshToken, type StaffAccessTokenClaims } from "./jwt.js";

function getRefreshTtlDays(): number {
  const raw = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? "7");
  return Number.isFinite(raw) && raw > 0 ? raw : 7;
}

type ClaimsResult = { ok: true; claims: StaffAccessTokenClaims } | { ok: false; reason: "invalid" | "blocked" };

async function loadClaims(userId: string): Promise<ClaimsResult> {
  const user = await (prisma as any).user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      companyId: true,
      branchId: true,
      role: true,
      roleId: true,
      name: true,
      company: { select: { isActive: true } }
    }
  });
  if (!user || !user.companyId) return { ok: false, reason: "invalid" };
  if (user.company?.isActive === false) return { ok: false, reason: "blocked" };
  return {
    ok: true,
    claims: {
      sub: user.id,
      companyId: user.companyId,
      branchId: user.branchId ?? null,
      role: user.role,
      roleId: user.roleId ?? null,
      name: user.name ?? null
    }
  };
}

export type IssuedSession = { accessToken: string; refreshTokenRaw: string; refreshExpiresAt: Date };

export async function issueSession(userId: string): Promise<IssuedSession> {
  const result = await loadClaims(userId);
  if (result.ok === false) {
    throw new Error(
      result.reason === "blocked"
        ? "Cannot issue session: company access has been suspended"
        : "Cannot issue session: user not found or has no company"
    );
  }
  const claims = result.claims;

  const accessToken = signStaffAccessToken(claims);
  const refreshTokenRaw = generateRefreshTokenRaw();
  const refreshExpiresAt = new Date(Date.now() + getRefreshTtlDays() * 86_400_000);
  const id = crypto.randomUUID();

  await (prisma as any).refreshToken.create({
    data: {
      id,
      userId,
      tokenHash: hashRefreshToken(refreshTokenRaw),
      familyId: id,
      expiresAt: refreshExpiresAt
    }
  });

  return { accessToken, refreshTokenRaw, refreshExpiresAt };
}

export type RotateResult =
  | { ok: true; accessToken: string; refreshTokenRaw: string; refreshExpiresAt: Date }
  | { ok: false; reason: "invalid" | "expired" | "reused" | "blocked" };

/** Rotates a refresh token. Presenting an already-revoked token is treated as a breach signal
 *  (e.g. a stolen, already-used token replayed by an attacker) and revokes the entire rotation
 *  family, not just the presented token. */
export async function rotateSession(refreshTokenRaw: string): Promise<RotateResult> {
  const tokenHash = hashRefreshToken(refreshTokenRaw);
  const existing = await (prisma as any).refreshToken.findUnique({ where: { tokenHash } });
  if (!existing) return { ok: false, reason: "invalid" };

  if (existing.revokedAt) {
    await (prisma as any).refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    return { ok: false, reason: "reused" };
  }

  if (existing.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  const claimsResult = await loadClaims(existing.userId);
  if (claimsResult.ok === false) return { ok: false, reason: claimsResult.reason };
  const claims = claimsResult.claims;

  const newRefreshRaw = generateRefreshTokenRaw();
  const refreshExpiresAt = new Date(Date.now() + getRefreshTtlDays() * 86_400_000);
  const newId = crypto.randomUUID();

  await prisma.$transaction(async (tx) => {
    await (tx as any).refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedByTokenId: newId }
    });
    await (tx as any).refreshToken.create({
      data: {
        id: newId,
        userId: existing.userId,
        tokenHash: hashRefreshToken(newRefreshRaw),
        familyId: existing.familyId,
        expiresAt: refreshExpiresAt
      }
    });
  });

  const accessToken = signStaffAccessToken(claims);
  return { ok: true, accessToken, refreshTokenRaw: newRefreshRaw, refreshExpiresAt };
}

/** Logout: revokes only the single presented refresh token (this device/browser). */
export async function revokeSession(refreshTokenRaw: string): Promise<void> {
  const tokenHash = hashRefreshToken(refreshTokenRaw);
  await (prisma as any).refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() }
  });
}

/** Used on password change: force re-login on every other active session. */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await (prisma as any).refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
}
