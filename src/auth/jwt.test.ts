import { describe, it, expect, beforeAll } from "vitest";
import {
  signStaffAccessToken,
  verifyStaffAccessToken,
  signPartnerAccessToken,
  verifyPartnerAccessToken,
  generateRefreshTokenRaw,
  hashRefreshToken,
  type StaffAccessTokenClaims,
  type PartnerAccessTokenClaims
} from "./jwt.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-do-not-use-in-production-0123456789";
});

const staffClaims: StaffAccessTokenClaims = {
  sub: "user-1",
  companyId: "company-1",
  branchId: "branch-1",
  role: "USER",
  roleId: "role-1",
  name: "Test User"
};

const partnerClaims: PartnerAccessTokenClaims = {
  sub: "partner-1",
  companyId: "company-1",
  branchId: "branch-1",
  partnerType: "BUYER",
  name: "Test Partner"
};

describe("signStaffAccessToken / verifyStaffAccessToken", () => {
  it("round-trips claims through sign and verify", () => {
    const token = signStaffAccessToken(staffClaims);
    const decoded = verifyStaffAccessToken(token);
    expect(decoded).toEqual(staffClaims);
  });

  it("preserves null branchId/roleId/name", () => {
    const claims: StaffAccessTokenClaims = { ...staffClaims, branchId: null, roleId: null, name: null };
    const token = signStaffAccessToken(claims);
    expect(verifyStaffAccessToken(token)).toEqual(claims);
  });

  it("rejects a tampered token", () => {
    const token = signStaffAccessToken(staffClaims);
    const tampered = token.slice(0, -2) + (token.endsWith("A") ? "B" : "A");
    expect(() => verifyStaffAccessToken(tampered)).toThrow();
  });

  it("rejects an expired token", async () => {
    process.env.ACCESS_TOKEN_TTL = "1s";
    const token = signStaffAccessToken(staffClaims);
    await new Promise((r) => setTimeout(r, 1100));
    expect(() => verifyStaffAccessToken(token)).toThrow();
    delete process.env.ACCESS_TOKEN_TTL;
  });
});

describe("signPartnerAccessToken / verifyPartnerAccessToken", () => {
  it("round-trips claims through sign and verify", () => {
    const token = signPartnerAccessToken(partnerClaims);
    const decoded = verifyPartnerAccessToken(token);
    expect(decoded).toEqual(partnerClaims);
  });

  it("preserves null branchId/name", () => {
    const claims: PartnerAccessTokenClaims = { ...partnerClaims, branchId: null, name: null };
    const token = signPartnerAccessToken(claims);
    expect(verifyPartnerAccessToken(token)).toEqual(claims);
  });
});

describe("audience separation", () => {
  it("rejects a staff token presented as a partner token", () => {
    const staffToken = signStaffAccessToken(staffClaims);
    expect(() => verifyPartnerAccessToken(staffToken)).toThrow();
  });

  it("rejects a partner token presented as a staff token", () => {
    const partnerToken = signPartnerAccessToken(partnerClaims);
    expect(() => verifyStaffAccessToken(partnerToken)).toThrow();
  });
});

describe("generateRefreshTokenRaw / hashRefreshToken", () => {
  it("generates unique, high-entropy raw tokens", () => {
    const a = generateRefreshTokenRaw();
    const b = generateRefreshTokenRaw();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(40);
  });

  it("hashes deterministically", () => {
    const raw = generateRefreshTokenRaw();
    expect(hashRefreshToken(raw)).toBe(hashRefreshToken(raw));
  });

  it("produces different hashes for different tokens", () => {
    const a = generateRefreshTokenRaw();
    const b = generateRefreshTokenRaw();
    expect(hashRefreshToken(a)).not.toBe(hashRefreshToken(b));
  });
});
