import { prisma } from "../prisma.js";

type TenantScope = { companyId: string; branchId?: string | null };

/**
 * Align contract status with installment overdue rows: ACTIVE ↔ OVERDUE only.
 * Call after marking installments overdue or after receipt allocation changes installment status.
 */
export async function syncContractOverdueFromInstallments(): Promise<void> {
  await prisma.contract.updateMany({
    where: {
      status: "ACTIVE",
      installments: { some: { status: "OVERDUE" } }
    },
    data: { status: "OVERDUE" }
  });
  await prisma.contract.updateMany({
    where: {
      status: "OVERDUE",
      installments: { none: { status: "OVERDUE" } }
    },
    data: { status: "ACTIVE" }
  });
}

export async function syncContractOverdueFromInstallmentsForTenant(scope: TenantScope): Promise<void> {
  const whereTenant: any = {
    company: { is: { id: scope.companyId } },
    ...(scope.branchId ? { branch: { is: { id: scope.branchId } } } : {})
  };

  await prisma.contract.updateMany({
    where: {
      ...whereTenant,
      status: "ACTIVE",
      installments: { some: { status: "OVERDUE" } }
    },
    data: { status: "OVERDUE" }
  });
  await prisma.contract.updateMany({
    where: {
      ...whereTenant,
      status: "OVERDUE",
      installments: { none: { status: "OVERDUE" } }
    },
    data: { status: "ACTIVE" }
  });
}

/** After payments/deallocations for a single contract — avoids a full-table scan. */
export async function syncContractOverdueStatusForContract(contractId: string): Promise<void> {
  const row = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { status: true }
  });
  if (!row) return;
  // Do not override terminal / externally-managed states.
  if (["REPOSSESSED", "CLOSED", "CANCELLED", "DEFAULTED"].includes(String(row.status))) return;

  let inst: Array<{ status: any; dueDate: Date; paidAt?: Date | null }> = [];
  try {
    inst = await prisma.installment.findMany({
      where: { contractId },
      select: { status: true, dueDate: true, paidAt: true } as any
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unknown argument `paidAt`") || msg.includes("Unknown argument 'paidAt'")) {
      inst = await prisma.installment.findMany({
        where: { contractId },
        select: { status: true, dueDate: true } as any
      });
    } else {
      throw e;
    }
  }
  if (!inst.length) return;

  const hasOverdue = inst.some((i) => i.status === "OVERDUE");
  const allPaid = inst.every((i) => i.status === "PAID");

  if (allPaid) {
    const canDetectEarly = inst.every((i) => typeof (i as any).paidAt !== "undefined");
    const early = canDetectEarly
      ? inst.every((i) => (i as any).paidAt && new Date((i as any).paidAt).getTime() <= new Date(i.dueDate).getTime())
      : false;
    const next = early ? "EARLY_PAID" : "COMPLETED";
    if (row.status !== next) {
      await prisma.contract.update({ where: { id: contractId }, data: { status: next as any } });
    }
    return;
  }

  // Otherwise maintain ACTIVE/OVERDUE only (don't force DRAFT, etc.)
  if (hasOverdue && row.status === "ACTIVE") {
    await prisma.contract.update({ where: { id: contractId }, data: { status: "OVERDUE" } });
  } else if (!hasOverdue && row.status === "OVERDUE") {
    await prisma.contract.update({ where: { id: contractId }, data: { status: "ACTIVE" } });
  }
}

export async function markOverdueInstallmentsForTenant(scope: TenantScope) {
  const now = new Date();
  const cfg = await prisma.systemConfig.findUnique({
    where: { companyId_key: { companyId: scope.companyId, key: "process.overdueGraceDays" } }
  });
  const graceDays = Math.max(0, Math.min(365, parseInt(String(cfg?.value ?? "0"), 10) || 0));
  const cutoff = new Date(now.getTime() - graceDays * 24 * 60 * 60 * 1000);
  await prisma.installment.updateMany({
    where: {
      dueDate: { lt: cutoff },
      status: { in: ["PENDING", "PARTIAL"] },
      contract: {
        company: { is: { id: scope.companyId } },
        ...(scope.branchId ? { branch: { is: { id: scope.branchId } } } : {})
      }
    } as any,
    data: { status: "OVERDUE" }
  });
  await syncContractOverdueFromInstallmentsForTenant(scope);
}
