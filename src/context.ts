import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  companyId: string;
  branchId: string | null;
  userId: string;
  userName: string | null;
  role: string;
  roleId: string | null;
};

const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}
