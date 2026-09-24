import { getRequestContext } from "../context.js";

export type TenantConnect = {
  company: { connect: { id: string } };
  branch?: { connect: { id: string } };
};

export function tenantConnectOrThrow(): TenantConnect {
  const companyId = getRequestContext()?.companyId;
  if (!companyId) throw new Error("Missing tenant companyId. Please login again.");
  const branchId = getRequestContext()?.branchId ?? null;
  return {
    company: { connect: { id: companyId } },
    ...(branchId ? { branch: { connect: { id: branchId } } } : {})
  };
}

export function connectById(id: string) {
  return { connect: { id } };
}

