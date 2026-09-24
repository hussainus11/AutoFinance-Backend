import { AsyncLocalStorage } from "node:async_hooks";

/** Fully separate from `context.ts`'s staff RequestContext/AsyncLocalStorage — a partner
 *  request must never be able to pick up staff context or vice versa. */
export type PortalRequestContext = {
  companyId: string;
  branchId: string | null;
  partnerId: string;
  partnerType: string;
  partnerName: string | null;
};

const storage = new AsyncLocalStorage<PortalRequestContext>();

export function getPortalContext(): PortalRequestContext | undefined {
  return storage.getStore();
}

export function runWithPortalContext<T>(ctx: PortalRequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}
