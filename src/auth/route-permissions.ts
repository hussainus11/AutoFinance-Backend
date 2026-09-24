/**
 * Maps API route prefixes to the permission key (from frontend/lib/permissions.ts) required
 * to access them. Reuses the existing, page-level permission catalog rather than inventing new
 * granularity. Anything not listed here requires authentication only, no additional permission.
 */
export const ROUTE_PERMISSIONS: Array<{ prefix: string; key: string }> = [
  { prefix: "/dashboard", key: "/dashboard/autofinance" },
  { prefix: "/partners", key: "/dashboard/autofinance/partners" },
  { prefix: "/vehicles", key: "/dashboard/autofinance/vehicles" },
  { prefix: "/vehicle-types", key: "/dashboard/autofinance/setup/vehicle-types" },
  { prefix: "/charts", key: "/dashboard/autofinance/charts" },
  { prefix: "/campaigns", key: "/dashboard/autofinance/campaigns" },
  { prefix: "/contracts", key: "/dashboard/autofinance/contracts" },
  { prefix: "/late-fee-waivers", key: "/dashboard/autofinance/contracts" },
  { prefix: "/restructure-requests", key: "/dashboard/autofinance/contracts" },
  { prefix: "/quotations", key: "/dashboard/autofinance/quotations" },
  { prefix: "/task-queue-requests", key: "/dashboard/autofinance/task-queue" },
  { prefix: "/processes", key: "/dashboard/autofinance/processes" },
  { prefix: "/receipts", key: "/dashboard/autofinance/payments/receipts" },
  { prefix: "/allocations", key: "/dashboard/autofinance/payments/allocations" },
  { prefix: "/collections", key: "/dashboard/autofinance/collections" },
  { prefix: "/recovery", key: "/dashboard/autofinance/collections" },
  { prefix: "/expense-categories", key: "/dashboard/autofinance/expenses" },
  { prefix: "/expenses", key: "/dashboard/autofinance/expenses" },
  { prefix: "/commissions", key: "/dashboard/autofinance/commissions" },
  { prefix: "/accounting", key: "/dashboard/autofinance/accounting" },
  { prefix: "/reports", key: "/dashboard/autofinance/reports" },
  { prefix: "/audit-logs", key: "/dashboard/autofinance/reports" },
  { prefix: "/templates", key: "/dashboard/autofinance/templates" },
  { prefix: "/users", key: "/dashboard/autofinance/users" },
  { prefix: "/roles", key: "/dashboard/autofinance/users" },
  { prefix: "/settings", key: "/dashboard/autofinance/settings" },
  { prefix: "/tenancy", key: "/dashboard/autofinance/settings" }
  // Deliberately unmapped (authenticated-only, no permission key):
  // /notifications, /installments, /credits, /uploads (public), /webhooks (public), /health (public)
];

/** Longest-prefix-wins lookup; returns null if the path isn't gated by a permission key. */
export function permissionKeyForPath(path: string): string | null {
  let best: { prefix: string; key: string } | null = null;
  for (const entry of ROUTE_PERMISSIONS) {
    if (path === entry.prefix || path.startsWith(entry.prefix + "/")) {
      if (!best || entry.prefix.length > best.prefix.length) best = entry;
    }
  }
  return best?.key ?? null;
}
