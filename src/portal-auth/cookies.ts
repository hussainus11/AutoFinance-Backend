import type { Request, Response } from "express";

const ACCESS_COOKIE = "afp_access";
const REFRESH_COOKIE = "afp_refresh";
const REFRESH_COOKIE_PATH = "/api/portal/auth";

function cookieSecure(): boolean {
  return (process.env.COOKIE_SECURE ?? "true").trim().toLowerCase() !== "false";
}

function accessTokenMaxAgeMs(): number {
  const ttl = (process.env.ACCESS_TOKEN_TTL ?? "15m").trim();
  const match = /^(\d+)(s|m|h|d)$/.exec(ttl);
  if (!match) return 15 * 60_000;
  const unitMs = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "s" | "m" | "h" | "d"];
  return Number(match[1]) * unitMs;
}

export function setPortalAuthCookies(
  res: Response,
  accessToken: string,
  refreshTokenRaw: string,
  refreshExpiresAt: Date
): void {
  const secure = cookieSecure();
  res.cookie(ACCESS_COOKIE, accessToken, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: accessTokenMaxAgeMs()
  });
  res.cookie(REFRESH_COOKIE, refreshTokenRaw, {
    path: REFRESH_COOKIE_PATH,
    httpOnly: true,
    sameSite: "lax",
    secure,
    expires: refreshExpiresAt
  });
}

export function clearPortalAuthCookies(res: Response): void {
  const secure = cookieSecure();
  res.clearCookie(ACCESS_COOKIE, { path: "/", httpOnly: true, sameSite: "lax", secure });
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH, httpOnly: true, sameSite: "lax", secure });
}

export function readPortalAccessToken(req: Request): string | null {
  const fromCookie = req.cookies?.[ACCESS_COOKIE];
  if (typeof fromCookie === "string" && fromCookie.length > 0) return fromCookie;
  const authHeader = req.header("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token.length > 0) return token;
  }
  return null;
}

export function readPortalRefreshToken(req: Request): string | null {
  const fromCookie = req.cookies?.[REFRESH_COOKIE];
  return typeof fromCookie === "string" && fromCookie.length > 0 ? fromCookie : null;
}
