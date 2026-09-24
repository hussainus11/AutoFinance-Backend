import type { Request, Response } from "express";

const ACCESS_COOKIE = "af_access";
const REFRESH_COOKIE = "af_refresh";
const REFRESH_COOKIE_PATH = "/api/auth";

function cookieSecure(): boolean {
  return (process.env.COOKIE_SECURE ?? "true").trim().toLowerCase() !== "false";
}

function accessTokenMaxAgeMs(): number {
  // Best-effort UX hint for the browser; the JWT's own `exp` claim is what actually enforces expiry.
  const ttl = (process.env.ACCESS_TOKEN_TTL ?? "15m").trim();
  const match = /^(\d+)(s|m|h|d)$/.exec(ttl);
  if (!match) return 15 * 60_000;
  const unitMs = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "s" | "m" | "h" | "d"];
  return Number(match[1]) * unitMs;
}

export function setAuthCookies(
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

export function clearAuthCookies(res: Response): void {
  const secure = cookieSecure();
  res.clearCookie(ACCESS_COOKIE, { path: "/", httpOnly: true, sameSite: "lax", secure });
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH, httpOnly: true, sameSite: "lax", secure });
}

/** Reads the access token from the af_access cookie, or an `Authorization: Bearer` header
 *  (used by server-side Next.js RSC calls that go straight to the backend and must forward
 *  the httpOnly cookie value manually). */
export function readAccessToken(req: Request): string | null {
  const fromCookie = req.cookies?.[ACCESS_COOKIE];
  if (typeof fromCookie === "string" && fromCookie.length > 0) return fromCookie;
  const authHeader = req.header("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token.length > 0) return token;
  }
  return null;
}

export function readRefreshToken(req: Request): string | null {
  const fromCookie = req.cookies?.[REFRESH_COOKIE];
  return typeof fromCookie === "string" && fromCookie.length > 0 ? fromCookie : null;
}
