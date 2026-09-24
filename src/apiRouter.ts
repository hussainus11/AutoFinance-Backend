import { Router } from "express";
import { healthRouter } from "./controllers/health.controller.js";
import { requireAuth } from "./auth/require-auth.js";
import { requirePermissionForPath } from "./auth/require-permission.js";
import { requirePortalAuth } from "./portal-auth/require-portal-auth.js";
import { portalAuthRouter } from "./controllers/portal/portal-auth.controller.js";
import { portalMeRouter } from "./controllers/portal/portal-me.controller.js";
import { portalLoansRouter } from "./controllers/portal/portal-loans.controller.js";
import { portalCommissionsRouter } from "./controllers/portal/portal-commissions.controller.js";
import { portalVehiclesRouter } from "./controllers/portal/portal-vehicles.controller.js";
import { partnersRouter } from "./controllers/partners.controller.js";
import { vehiclesRouter } from "./controllers/vehicles.controller.js";
import { vehicleTypesRouter } from "./controllers/vehicle-types.controller.js";
import { contractsRouter } from "./controllers/contracts.controller.js";
import { installmentsRouter } from "./controllers/installments.controller.js";
import { receiptsRouter } from "./controllers/receipts.controller.js";
import { collectionsRouter } from "./controllers/collections.controller.js";
import { commissionsRouter } from "./controllers/commissions.controller.js";
import { recoveryRouter } from "./controllers/recovery.controller.js";
import { dashboardRouter } from "./controllers/dashboard.controller.js";
import { reportsRouter } from "./controllers/reports.controller.js";
import { settingsRouter } from "./controllers/settings.controller.js";
import { usersRouter } from "./controllers/users.controller.js";
import { uploadsRouter } from "./controllers/uploads.controller.js";
import { chartsRouter } from "./controllers/charts.controller.js";
import { campaignsRouter } from "./controllers/campaigns.controller.js";
import { taskQueueRouter } from "./controllers/task-queue.controller.js";
import { processesRouter } from "./controllers/processes.controller.js";
import { expensesRouter } from "./controllers/expenses.controller.js";
import { quotationsRouter } from "./controllers/quotations.controller.js";
import { tenancyRouter } from "./controllers/tenancy.controller.js";
import { authRouter } from "./controllers/auth.controller.js";
import { templatesRouter } from "./controllers/templates.controller.js";
import { accountingRouter } from "./controllers/accounting.controller.js";
import { creditsRouter } from "./controllers/credits.controller.js";
import { rolesRouter } from "./controllers/roles.controller.js";
import { notificationsRouter } from "./controllers/notifications.controller.js";
import { webhooksRouter } from "./controllers/webhooks.controller.js";
import { platformRouter } from "./controllers/platform.controller.js";

/**
 * Composes all Auto Finance API routes. Each feature lives in `controllers/*`
 * with handlers that read/write Postgres via Prisma (same URLs as before).
 */
export const apiRouter = Router();

const PUBLIC_PATHS = new Set(["/health", "/tenancy/onboarding", "/auth/login", "/auth/refresh", "/auth/logout"]);
const PORTAL_PUBLIC_PATHS = new Set(["/portal/auth/login", "/portal/auth/refresh", "/portal/auth/logout"]);

function isPortalInvitePath(path: string): boolean {
  return /^\/portal\/auth\/invite\/[^/]+(\/activate)?$/.test(path);
}

// The partner portal is a fully separate principal type from staff (see portal-context.ts /
// portal-auth/*) — it never goes through requireAuth/requirePermissionForPath below.
apiRouter.use((req, res, next) => {
  if (req.path.startsWith("/portal/")) {
    if (PORTAL_PUBLIC_PATHS.has(req.path) || isPortalInvitePath(req.path)) return next();
    return requirePortalAuth(req, res, next);
  }
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (req.path.startsWith("/uploads/")) return next(); // public uploads
  if (req.path.startsWith("/webhooks/")) return next(); // public webhooks
  return requireAuth(req, res, next);
});

// Second pass: staff permission-key enforcement only — the portal uses ownership-based
// authorization inside each controller instead (the staff Role/RolePermission system treats
// "no roleId assigned" as unrestricted, which would be the wrong default for an external,
// less-trusted principal type).
apiRouter.use((req, res, next) => {
  if (req.path.startsWith("/portal/")) return next();
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (req.path.startsWith("/uploads/") || req.path.startsWith("/webhooks/")) return next();
  return requirePermissionForPath(req, res, next);
});

const routers = [
  healthRouter,
  webhooksRouter,
  partnersRouter,
  vehiclesRouter,
  vehicleTypesRouter,
  contractsRouter,
  installmentsRouter,
  receiptsRouter,
  collectionsRouter,
  commissionsRouter,
  recoveryRouter,
  dashboardRouter,
  reportsRouter,
  settingsRouter,
  usersRouter,
  rolesRouter,
  notificationsRouter,
  uploadsRouter,
  chartsRouter,
  campaignsRouter,
  taskQueueRouter,
  processesRouter,
  expensesRouter,
  quotationsRouter,
  templatesRouter,
  accountingRouter,
  creditsRouter,
  tenancyRouter,
  authRouter,
  platformRouter,
  portalAuthRouter,
  portalMeRouter,
  portalLoansRouter,
  portalCommissionsRouter,
  portalVehiclesRouter
];

for (const r of routers) {
  apiRouter.use(r);
}
