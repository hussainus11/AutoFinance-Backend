import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { getRequestContext } from "./context.js";

const base = new PrismaClient() as any;

function safeJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

async function writeAuditLog(params: {
  companyId?: string;
  branchId?: string | null;
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  payload?: unknown;
}) {
  try {
    // Avoid recursion: use base client (not extended).
    await base.auditLog.create({
      data: {
        ...(params.companyId ? { company: { connect: { id: params.companyId } } } : {}),
        ...(params.branchId ? { branch: { connect: { id: params.branchId } } } : {}),
        ...(params.userId ? { user: { connect: { id: params.userId } } } : {}),
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        payload: params.payload === undefined ? undefined : (safeJson(params.payload) as any)
      }
    });
  } catch {
    // Never fail the primary mutation because audit log couldn't be written.
  }
}

// Tenancy enforcement using Prisma Client extensions (Prisma 6+ compatible).
export const prisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }: any) {
        const ctx = getRequestContext();
        const companyId = ctx?.companyId;
        const branchId = ctx?.branchId ?? null;
        const userId = ctx?.userId;
        const userName = ctx?.userName ?? undefined;
        const auditUnsupportedModels = new Set(["FinanceChart"]);

        const tenantModels = new Set([
          "FinanceChart",
          "User",
          "Role",
          "RolePermission",
          "Notification",
          "BranchSecretConfig",
          "CompanySecretConfig",
          "Partner",
          "PartnerPhone",
          "PartnerEmail",
          "PartnerAddress",
          "PartnerDocument",
          "Vehicle",
          "VehicleImage",
          "VehicleType",
          "Campaign",
          "CampaignVehicle",
          "CampaignChart",
          "Contract",
          "Quotation",
          "QuotationVehicle",
          "QuotationGuarantor",
          "QuotationInstallment",
          "TaskQueueRequest",
          "ContractVehicle",
          "ContractGuarantor",
          "Installment",
          "InstallmentHistory",
          "RestructureRequest",
          "LateFeeWaiver",
          "ProcessRun",
          "InstallmentReminderLog",
          "Receipt",
          "ReceiptAllocation",
          "Commission",
          "RecoveryCase",
          "ExpenseCategory",
          "Expense",
          "DocumentTemplate"
        ]);

        if (!companyId || !model || !tenantModels.has(model)) {
          return query(args);
        }

        const whereOps = new Set([
          "findMany",
          "findFirst",
          "findUnique",
          "count",
          "aggregate",
          "groupBy",
          "updateMany",
          "deleteMany"
        ]);

        const nextArgs = args ?? {};

        // Models scoped by company only (no branch relation in schema).
        const branchUnsupportedModels = new Set([
          "Notification",
          "Role",
          "RolePermission",
          "CompanySecretConfig"
        ]);

        if (whereOps.has(operation)) {
          nextArgs.where ??= {};
          // Compatibility: some Prisma Clients may not have companyId/branchId scalars yet.
          // Prefer relation filters so we don't pass unknown args.
          if (typeof nextArgs.where.companyId === "undefined" && typeof nextArgs.where.company === "undefined") {
            nextArgs.where.company = { is: { id: companyId } };
          }
          if (
            branchId &&
            !branchUnsupportedModels.has(model) &&
            typeof nextArgs.where.branchId === "undefined" &&
            typeof nextArgs.where.branch === "undefined"
          ) {
            nextArgs.where.branch = { is: { id: branchId } };
          }
          return query(nextArgs);
        }

        const isAuditLogModel = model === "AuditLog";
        const isSystemConfigModel = model === "SystemConfig";

        if (operation === "create") {
          nextArgs.data ??= {};
          // Compatibility: avoid injecting companyId/branchId scalars; connect relations instead.
          if (typeof nextArgs.data.companyId === "undefined" && typeof nextArgs.data.company === "undefined") {
            nextArgs.data.company = { connect: { id: companyId } };
          }
          if (
            branchId &&
            !branchUnsupportedModels.has(model) &&
            typeof nextArgs.data.branchId === "undefined" &&
            typeof nextArgs.data.branch === "undefined"
          ) {
            nextArgs.data.branch = { connect: { id: branchId } };
          }

          // Audit columns (optional per-table).
          if (!auditUnsupportedModels.has(model)) {
            if (userId) {
              if (typeof nextArgs.data.createdByUserId === "undefined") nextArgs.data.createdByUserId = userId;
              if (typeof nextArgs.data.updatedByUserId === "undefined") nextArgs.data.updatedByUserId = userId;
            }
            if (userName) {
              if (typeof nextArgs.data.createdByName === "undefined") nextArgs.data.createdByName = userName;
              if (typeof nextArgs.data.updatedByName === "undefined") nextArgs.data.updatedByName = userName;
            }
          }
          const result = await query(nextArgs);
          if (!isAuditLogModel && !isSystemConfigModel) {
            await writeAuditLog({
              companyId,
              branchId,
              userId,
              action: "CREATE",
              entityType: model,
              entityId: (result as any)?.id ?? null,
              payload: { data: nextArgs.data }
            });
          }
          return result;
        }

        if (operation === "update") {
          nextArgs.data ??= {};
          if (!auditUnsupportedModels.has(model)) {
            if (userId) nextArgs.data.updatedByUserId = userId;
            if (userName) nextArgs.data.updatedByName = userName;
          }
          const result = await query(nextArgs);
          if (!isAuditLogModel && !isSystemConfigModel) {
            const whereId = (nextArgs.where as any)?.id ?? null;
            await writeAuditLog({
              companyId,
              branchId,
              userId,
              action: "UPDATE",
              entityType: model,
              entityId: (result as any)?.id ?? whereId,
              payload: { where: nextArgs.where, data: nextArgs.data }
            });
          }
          return result;
        }

        if (operation === "updateMany") {
          nextArgs.data ??= {};
          if (!auditUnsupportedModels.has(model)) {
            if (userId) nextArgs.data.updatedByUserId = userId;
            if (userName) nextArgs.data.updatedByName = userName;
          }
          const result = await query(nextArgs);
          if (!isAuditLogModel && !isSystemConfigModel) {
            await writeAuditLog({
              companyId,
              branchId,
              userId,
              action: "UPDATE_MANY",
              entityType: model,
              entityId: null,
              payload: { where: nextArgs.where, data: nextArgs.data, result }
            });
          }
          return result;
        }

        if (operation === "createMany") {
          // NOTE: createMany cannot connect relations; if Prisma Client is outdated and doesn't know companyId,
          // callers must avoid createMany for tenant models (use create in a loop).
          const result = await query(nextArgs);
          if (!isAuditLogModel && !isSystemConfigModel) {
            await writeAuditLog({
              companyId,
              branchId,
              userId,
              action: "CREATE_MANY",
              entityType: model,
              entityId: null,
              payload: { data: nextArgs.data, result }
            });
          }
          return result;
        }

        if (operation === "delete") {
          const result = await query(nextArgs);
          if (!isAuditLogModel && !isSystemConfigModel) {
            const whereId = (nextArgs.where as any)?.id ?? null;
            await writeAuditLog({
              companyId,
              branchId,
              userId,
              action: "DELETE",
              entityType: model,
              entityId: (result as any)?.id ?? whereId,
              payload: { where: nextArgs.where }
            });
          }
          return result;
        }

        if (operation === "deleteMany") {
          const result = await query(nextArgs);
          if (!isAuditLogModel && !isSystemConfigModel) {
            await writeAuditLog({
              companyId,
              branchId,
              userId,
              action: "DELETE_MANY",
              entityType: model,
              entityId: null,
              payload: { where: nextArgs.where, result }
            });
          }
          return result;
        }

        return query(nextArgs);
      }
    }
  }
}) as any;
