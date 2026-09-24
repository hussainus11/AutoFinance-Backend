import rateLimit from "express-rate-limit";

/** Brute-force protection for staff login/refresh. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

/** Separate quota for the partner portal's login/refresh/invite endpoints — kept independent
 *  of the staff limiter so the two attack surfaces/user populations don't share a budget. */
export const portalAuthLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

/** General abuse guard for the whole API. */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
});
