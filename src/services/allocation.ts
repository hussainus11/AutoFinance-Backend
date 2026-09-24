import { Prisma, type InstallmentStatus, type ReceiptState } from "@prisma/client";
import { prisma } from "../prisma.js";
import { syncContractOverdueStatusForContract } from "./collections.js";
import { getRequestContext } from "../context.js";

const CFG_ALLOC_ORDER = "receipt.allocation.order";

type AllocationComponent = "LATE_FEE" | "TAX" | "INTEREST" | "PRINCIPAL";

const DEFAULT_ALLOC_ORDER: AllocationComponent[] = ["LATE_FEE", "TAX", "INTEREST", "PRINCIPAL"];

async function getAllocationOrder(tx: any): Promise<AllocationComponent[]> {
  const companyId = getRequestContext()?.companyId;
  if (!companyId) return DEFAULT_ALLOC_ORDER;
  const row = await tx.systemConfig.findUnique({
    where: { companyId_key: { companyId, key: CFG_ALLOC_ORDER } }
  });
  if (!row?.value) return DEFAULT_ALLOC_ORDER;
  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_ALLOC_ORDER;
    const list = parsed.map((v) => String(v).toUpperCase()) as AllocationComponent[];
    const allowed = new Set<AllocationComponent>(["LATE_FEE", "TAX", "INTEREST", "PRINCIPAL"]);
    const uniq: AllocationComponent[] = [];
    for (const v of list) if (allowed.has(v) && !uniq.includes(v)) uniq.push(v);
    for (const v of DEFAULT_ALLOC_ORDER) if (!uniq.includes(v)) uniq.push(v);
    return uniq;
  } catch {
    return DEFAULT_ALLOC_ORDER;
  }
}

function installmentStatusFromPaid(totalDue: Prisma.Decimal, paid: Prisma.Decimal): InstallmentStatus {
  if (paid.gte(totalDue)) return "PAID";
  if (paid.gt(0)) return "PARTIAL";
  return "PENDING";
}

function paidAtFromTransition(
  prevStatus: string,
  nextStatus: string,
  prevPaidAt: Date | null | undefined
): Date | null | undefined {
  if (String(nextStatus) === "PAID") return prevPaidAt ?? new Date();
  if (String(prevStatus) === "PAID" && String(nextStatus) !== "PAID") return null;
  return prevPaidAt ?? undefined;
}

function installmentTotalDue(inst: {
  principalDue: Prisma.Decimal;
  interestDue: Prisma.Decimal;
  taxDue?: Prisma.Decimal | null;
}): Prisma.Decimal {
  return inst.principalDue.add(inst.interestDue).add(inst.taxDue ?? new Prisma.Decimal(0));
}

async function allocateReceiptFifoTx(tx: any, receiptId: string) {
  const receipt = await tx.receipt.findUnique({
    where: { id: receiptId },
    include: { allocations: true }
  });
  if (!receipt) throw new Error("Receipt not found");
  if (receipt.state === "CANCELLED") throw new Error("Receipt is cancelled");

  const allocatedSum = receipt.allocations.reduce(
    (s, a) => s.add(a.amount),
    new Prisma.Decimal(0)
  );
  let remaining = receipt.amount.sub(allocatedSum);
  if (remaining.lte(0)) {
    await prisma.receipt.update({
      where: { id: receiptId },
      data: { state: "ALLOCATED" as ReceiptState }
    });
    return { receiptId, allocated: "0" };
  }

  const installments = await tx.installment.findMany({
    where: { contractId: receipt.contractId },
    orderBy: [{ dueDate: "asc" }, { sequence: "asc" }]
  });

  const order = await getAllocationOrder(tx);
  for (const inst of installments) {
    if (remaining.lte(0)) break;
    const dueTotal = installmentTotalDue(inst);
    const principalPaid = (inst as { principalPaid?: Prisma.Decimal }).principalPaid ?? new Prisma.Decimal(0);
    const interestPaid = (inst as { interestPaid?: Prisma.Decimal }).interestPaid ?? new Prisma.Decimal(0);
    const taxPaid = (inst as { taxPaid?: Prisma.Decimal }).taxPaid ?? new Prisma.Decimal(0);
    const principalOutstanding = inst.principalDue.sub(principalPaid);
    const interestOutstanding = inst.interestDue.sub(interestPaid);
    const taxDue = (inst as any).taxDue as Prisma.Decimal | null | undefined;
    const taxOutstanding = ((taxDue as any) ?? new Prisma.Decimal(0)).sub(taxPaid);
    const lateOutstanding = new Prisma.Decimal(inst.lateFeeAccrued ?? 0);

      const installmentsOutstanding = Prisma.Decimal.max(
        new Prisma.Decimal(0),
        dueTotal.sub(principalPaid.add(interestPaid).add(taxPaid))
      );
      if (installmentsOutstanding.lte(0) && lateOutstanding.lte(0)) continue;

      let newPrincipalPaid = principalPaid;
      let newInterestPaid = interestPaid;
      let newTaxPaid = taxPaid;
      let newLateFeeAccrued = new Prisma.Decimal(inst.lateFeeAccrued ?? 0);

      const applyComponent = async (component: AllocationComponent, amount: Prisma.Decimal) => {
        if (amount.lte(0)) return;
        // Back-compat: if the running Prisma Client was generated before `ReceiptAllocation.component`
        // existed, fall back to legacy rows (component omitted) instead of crashing.
        try {
          await tx.receiptAllocation.create({
            data: {
              receipt: { connect: { id: receipt.id } },
              installment: { connect: { id: inst.id } },
              component,
              amount
            } as any
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("Unknown argument `component`") || msg.includes("Unknown argument 'component'")) {
            await tx.receiptAllocation.create({
              data: {
                receipt: { connect: { id: receipt.id } },
                installment: { connect: { id: inst.id } },
                amount
              } as any
            });
            return;
          }
          throw e;
        }
      };

      for (const comp of order) {
        if (remaining.lte(0)) break;
        if (comp === "LATE_FEE") {
          const out = Prisma.Decimal.max(new Prisma.Decimal(0), newLateFeeAccrued);
          if (out.lte(0)) continue;
          const apply = remaining.lt(out) ? remaining : out;
          newLateFeeAccrued = newLateFeeAccrued.sub(apply);
          remaining = remaining.sub(apply);
          await applyComponent("LATE_FEE", apply);
        } else if (comp === "TAX") {
          const out = Prisma.Decimal.max(new Prisma.Decimal(0), taxOutstanding.sub(newTaxPaid.sub(taxPaid)));
          if (out.lte(0)) continue;
          const apply = remaining.lt(out) ? remaining : out;
          newTaxPaid = newTaxPaid.add(apply);
          remaining = remaining.sub(apply);
          await applyComponent("TAX", apply);
        } else if (comp === "INTEREST") {
          const out = Prisma.Decimal.max(new Prisma.Decimal(0), interestOutstanding.sub(newInterestPaid.sub(interestPaid)));
          if (out.lte(0)) continue;
          const apply = remaining.lt(out) ? remaining : out;
          newInterestPaid = newInterestPaid.add(apply);
          remaining = remaining.sub(apply);
          await applyComponent("INTEREST", apply);
        } else if (comp === "PRINCIPAL") {
          const out = Prisma.Decimal.max(new Prisma.Decimal(0), principalOutstanding.sub(newPrincipalPaid.sub(principalPaid)));
          if (out.lte(0)) continue;
          const apply = remaining.lt(out) ? remaining : out;
          newPrincipalPaid = newPrincipalPaid.add(apply);
          remaining = remaining.sub(apply);
          await applyComponent("PRINCIPAL", apply);
        }
      }

      const newPaid = newPrincipalPaid.add(newInterestPaid).add(newTaxPaid);
      const nextStatus = installmentStatusFromPaid(dueTotal, newPaid);
      const prevStatus = inst.status as InstallmentStatus;
      const prevPaidAt = (inst as any).paidAt as Date | null | undefined;
      try {
        await tx.installment.update({
          where: { id: inst.id },
          data: {
            paidAmount: newPaid,
            principalPaid: newPrincipalPaid,
            interestPaid: newInterestPaid,
            taxPaid: newTaxPaid,
            lateFeeAccrued: newLateFeeAccrued,
            status: nextStatus,
            paidAt: paidAtFromTransition(prevStatus, nextStatus, prevPaidAt)
          } as any
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Unknown argument `paidAt`") || msg.includes("Unknown argument 'paidAt'")) {
          await tx.installment.update({
            where: { id: inst.id },
            data: {
              paidAmount: newPaid,
              principalPaid: newPrincipalPaid,
              interestPaid: newInterestPaid,
              taxPaid: newTaxPaid,
              lateFeeAccrued: newLateFeeAccrued,
              status: nextStatus
            } as any
          });
        } else {
          throw e;
        }
      }
  }

  const sum = await tx.receiptAllocation.aggregate({
    where: { receiptId },
    _sum: { amount: true }
  });
  const total = sum._sum.amount ?? new Prisma.Decimal(0);
  const unallocated = Prisma.Decimal.max(new Prisma.Decimal(0), receipt.amount.sub(total));
  const state: ReceiptState = total.gte(receipt.amount)
    ? "ALLOCATED"
    : total.gt(0)
      ? "ALLOCATED"
      : "CREATED";

  try {
    await tx.receipt.update({
      where: { id: receiptId },
      data: { state, unallocatedAmount: unallocated } as any
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unknown argument `unallocatedAmount`") || msg.includes("Unknown argument 'unallocatedAmount'")) {
      await tx.receipt.update({
        where: { id: receiptId },
        data: { state } as any
      });
    } else {
      throw e;
    }
  }

  // Track overpayment as a credit movement (one row per receipt).
  try {
    const srcContract = await tx.contract.findUnique({
      where: { id: receipt.contractId },
      select: { id: true, buyerId: true }
    });
    if (srcContract) {
      await tx.customerCreditMovement.upsert({
        where: {
          companyId_sourceReceiptId_type: {
            companyId: receipt.companyId,
            sourceReceiptId: receipt.id,
            type: "OVERPAYMENT"
          }
        } as any,
        create: {
          companyId: receipt.companyId,
          ...(receipt.branchId ? { branchId: receipt.branchId } : {}),
          buyerId: srcContract.buyerId,
          type: "OVERPAYMENT",
          amount: unallocated,
          sourceReceiptId: receipt.id,
          sourceContractId: srcContract.id,
          note: `Overpayment on receipt ${String(receipt.id).slice(0, 8)}`
        } as any,
        update: { amount: unallocated } as any
      });
    }
  } catch {
    // Ignore ledger errors (older DB/client) to keep allocation working.
  }

  return { receipt, state };
}

/** FIFO by due date: apply unallocated receipt amount to earliest unpaid installments. */
export async function allocateReceiptFifo(receiptId: string) {
  const out = await prisma.$transaction(async (tx) => {
    const { receipt } = await allocateReceiptFifoTx(tx, receiptId);
    return { contractId: receipt.contractId };
  });
  await syncContractOverdueStatusForContract(out.contractId);
  return { receiptId, ok: true };
}

export async function allocateReceiptFifoInTx(tx: any, receiptId: string) {
  const { receipt } = await allocateReceiptFifoTx(tx, receiptId);
  // Note: caller controls transaction. Sync overdue status is done after commit by caller.
  return { receiptId, contractId: receipt.contractId };
}

/** Manual allocation: apply receipt amount to a specific installment. */
export async function allocateReceiptManualToInstallment(receiptId: string, installmentId: string) {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: { allocations: true }
  });
  if (!receipt) throw new Error("Receipt not found");
  if (receipt.state === "CANCELLED") throw new Error("Receipt is cancelled");

  const allocatedSum = receipt.allocations.reduce(
    (s, a) => s.add(a.amount),
    new Prisma.Decimal(0)
  );
  let remaining = receipt.amount.sub(allocatedSum);
  if (remaining.lte(0)) {
    await prisma.receipt.update({ where: { id: receiptId }, data: { state: "ALLOCATED" as ReceiptState } });
    return { receiptId, ok: true };
  }

  const inst = await prisma.installment.findUnique({ where: { id: installmentId } });
  if (!inst) throw new Error("Installment not found");
  if (inst.contractId !== receipt.contractId) throw new Error("Installment does not belong to receipt contract");

  await prisma.$transaction(async (tx) => {
    const order = await getAllocationOrder(tx);

    const dueTotal = installmentTotalDue(inst);
    const principalPaid = (inst as { principalPaid?: Prisma.Decimal }).principalPaid ?? new Prisma.Decimal(0);
    const interestPaid = (inst as { interestPaid?: Prisma.Decimal }).interestPaid ?? new Prisma.Decimal(0);
    const taxPaid = (inst as { taxPaid?: Prisma.Decimal }).taxPaid ?? new Prisma.Decimal(0);
    const principalOutstanding = inst.principalDue.sub(principalPaid);
    const interestOutstanding = inst.interestDue.sub(interestPaid);
    const taxDue = (inst as any).taxDue as Prisma.Decimal | null | undefined;
    const taxOutstanding = ((taxDue as any) ?? new Prisma.Decimal(0)).sub(taxPaid);
    const lateOutstanding = new Prisma.Decimal(inst.lateFeeAccrued ?? 0);

    let newPrincipalPaid = principalPaid;
    let newInterestPaid = interestPaid;
    let newTaxPaid = taxPaid;
    let newLateFeeAccrued = new Prisma.Decimal(inst.lateFeeAccrued ?? 0);

    const applyComponent = async (component: AllocationComponent, amount: Prisma.Decimal) => {
      if (amount.lte(0)) return;
      try {
        await tx.receiptAllocation.create({
          data: {
            receiptId: receipt.id,
            installmentId: inst.id,
            component,
            amount
          } as any
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Unknown argument `component`") || msg.includes("Unknown argument 'component'")) {
          await tx.receiptAllocation.create({
            data: {
              receiptId: receipt.id,
              installmentId: inst.id,
              amount
            } as any
          });
          return;
        }
        throw e;
      }
    };

    for (const comp of order) {
      if (remaining.lte(0)) break;
      if (comp === "LATE_FEE") {
        const out = Prisma.Decimal.max(new Prisma.Decimal(0), newLateFeeAccrued);
        if (out.lte(0)) continue;
        const apply = remaining.lt(out) ? remaining : out;
        newLateFeeAccrued = newLateFeeAccrued.sub(apply);
        remaining = remaining.sub(apply);
        await applyComponent("LATE_FEE", apply);
      } else if (comp === "TAX") {
        const out = Prisma.Decimal.max(new Prisma.Decimal(0), taxOutstanding.sub(newTaxPaid.sub(taxPaid)));
        if (out.lte(0)) continue;
        const apply = remaining.lt(out) ? remaining : out;
        newTaxPaid = newTaxPaid.add(apply);
        remaining = remaining.sub(apply);
        await applyComponent("TAX", apply);
      } else if (comp === "INTEREST") {
        const out = Prisma.Decimal.max(new Prisma.Decimal(0), interestOutstanding.sub(newInterestPaid.sub(interestPaid)));
        if (out.lte(0)) continue;
        const apply = remaining.lt(out) ? remaining : out;
        newInterestPaid = newInterestPaid.add(apply);
        remaining = remaining.sub(apply);
        await applyComponent("INTEREST", apply);
      } else if (comp === "PRINCIPAL") {
        const out = Prisma.Decimal.max(new Prisma.Decimal(0), principalOutstanding.sub(newPrincipalPaid.sub(principalPaid)));
        if (out.lte(0)) continue;
        const apply = remaining.lt(out) ? remaining : out;
        newPrincipalPaid = newPrincipalPaid.add(apply);
        remaining = remaining.sub(apply);
        await applyComponent("PRINCIPAL", apply);
      }
    }

    const newPaid = newPrincipalPaid.add(newInterestPaid).add(newTaxPaid);
    const nextStatus = installmentStatusFromPaid(dueTotal, newPaid);
    const prevStatus = inst.status as InstallmentStatus;
    const prevPaidAt = (inst as any).paidAt as Date | null | undefined;
    try {
      await tx.installment.update({
        where: { id: inst.id },
        data: {
          paidAmount: newPaid,
          principalPaid: newPrincipalPaid,
          interestPaid: newInterestPaid,
          taxPaid: newTaxPaid,
          lateFeeAccrued: newLateFeeAccrued,
          status: nextStatus,
          paidAt: paidAtFromTransition(prevStatus, nextStatus, prevPaidAt)
        } as any
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Unknown argument `paidAt`") || msg.includes("Unknown argument 'paidAt'")) {
        await tx.installment.update({
          where: { id: inst.id },
          data: {
            paidAmount: newPaid,
            principalPaid: newPrincipalPaid,
            interestPaid: newInterestPaid,
            taxPaid: newTaxPaid,
            lateFeeAccrued: newLateFeeAccrued,
            status: nextStatus
          } as any
        });
      } else {
        throw e;
      }
    }

    const sum = await tx.receiptAllocation.aggregate({
      where: { receiptId },
      _sum: { amount: true }
    });
    const total = sum._sum.amount ?? new Prisma.Decimal(0);
    const unallocated = Prisma.Decimal.max(new Prisma.Decimal(0), receipt.amount.sub(total));
    const state: ReceiptState = total.gt(0) ? "ALLOCATED" : "CREATED";

    try {
      await tx.receipt.update({
        where: { id: receiptId },
        data: { state, receiptType: "MANUAL" as any, unallocatedAmount: unallocated } as any
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Unknown argument `receiptType`") || msg.includes("Unknown argument 'receiptType'")) {
        await tx.receipt.update({
          where: { id: receiptId },
          data: { state, unallocatedAmount: unallocated } as any
        });
        return;
      }
      if (msg.includes("Unknown argument `unallocatedAmount`") || msg.includes("Unknown argument 'unallocatedAmount'")) {
        await tx.receipt.update({
          where: { id: receiptId },
          data: { state, receiptType: "MANUAL" as any } as any
        });
        return;
      }
      throw e;
    }
  });

  await syncContractOverdueStatusForContract(receipt.contractId);
  return { receiptId, ok: true };
}

export async function deallocateReceipt(receiptId: string) {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: { allocations: true }
  });
  if (!receipt) throw new Error("Receipt not found");
  if (receipt.state === "CANCELLED") throw new Error("Receipt is cancelled");
  // If there are no allocations, this receipt is simply unallocated (CREATED).
  // It should NOT be marked DEALLOCATED because nothing was deallocated.
  if (!receipt.allocations || receipt.allocations.length === 0) {
    if (receipt.state !== "CREATED") {
      await prisma.receipt.update({
        where: { id: receiptId },
        data: { state: "CREATED" as ReceiptState }
      });
    }
    return { receiptId, ok: true, skipped: true };
  }

  await prisma.$transaction(async (tx) => {
    const allocs = await tx.receiptAllocation.findMany({ where: { receiptId } });
    for (const a of allocs) {
      const inst = await tx.installment.findUnique({ where: { id: a.installmentId } });
      if (!inst) continue;
      const principalPaid = (inst as { principalPaid?: Prisma.Decimal }).principalPaid ?? new Prisma.Decimal(0);
      const interestPaid = (inst as { interestPaid?: Prisma.Decimal }).interestPaid ?? new Prisma.Decimal(0);
      const taxPaid = (inst as { taxPaid?: Prisma.Decimal }).taxPaid ?? new Prisma.Decimal(0);

      let newPrincipalPaid = principalPaid;
      let newInterestPaid = interestPaid;
      let newTaxPaid = taxPaid;
      let newLateFeeAccrued = new Prisma.Decimal(inst.lateFeeAccrued ?? 0);

      const comp = (a as any).component as string | undefined;
      if (comp === "PRINCIPAL") newPrincipalPaid = principalPaid.sub(a.amount);
      else if (comp === "INTEREST") newInterestPaid = interestPaid.sub(a.amount);
      else if (comp === "TAX") newTaxPaid = taxPaid.sub(a.amount);
      else if (comp === "LATE_FEE") newLateFeeAccrued = newLateFeeAccrued.add(a.amount);
      else {
        // Legacy allocation: treat as a generic payment towards installment total.
        newPrincipalPaid = principalPaid;
        newInterestPaid = interestPaid;
        newTaxPaid = taxPaid;
      }

      if (newPrincipalPaid.lt(0)) newPrincipalPaid = new Prisma.Decimal(0);
      if (newInterestPaid.lt(0)) newInterestPaid = new Prisma.Decimal(0);
      if (newTaxPaid.lt(0)) newTaxPaid = new Prisma.Decimal(0);

      const newPaid = newPrincipalPaid.add(newInterestPaid).add(newTaxPaid);
      const dueTotal = installmentTotalDue(inst);
      const nextStatus = installmentStatusFromPaid(dueTotal, newPaid);
      const prevStatus = inst.status as InstallmentStatus;
      const prevPaidAt = (inst as any).paidAt as Date | null | undefined;
      try {
        await tx.installment.update({
          where: { id: inst.id },
          data: {
            paidAmount: newPaid,
            principalPaid: newPrincipalPaid,
            interestPaid: newInterestPaid,
            taxPaid: newTaxPaid,
            lateFeeAccrued: newLateFeeAccrued,
            status: nextStatus,
            paidAt: paidAtFromTransition(prevStatus, nextStatus, prevPaidAt)
          } as any
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Unknown argument `paidAt`") || msg.includes("Unknown argument 'paidAt'")) {
          await tx.installment.update({
            where: { id: inst.id },
            data: {
              paidAmount: newPaid,
              principalPaid: newPrincipalPaid,
              interestPaid: newInterestPaid,
              taxPaid: newTaxPaid,
              lateFeeAccrued: newLateFeeAccrued,
              status: nextStatus
            } as any
          });
        } else {
          throw e;
        }
      }
    }
    await tx.receiptAllocation.deleteMany({ where: { receiptId } });
    try {
      await tx.receipt.update({
        where: { id: receiptId },
        data: { state: "DEALLOCATED" as ReceiptState, unallocatedAmount: receipt.amount } as any
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Unknown argument `unallocatedAmount`") || msg.includes("Unknown argument 'unallocatedAmount'")) {
        await tx.receipt.update({
          where: { id: receiptId },
          data: { state: "DEALLOCATED" as ReceiptState } as any
        });
      } else {
        throw e;
      }
    }
  });

  await syncContractOverdueStatusForContract(receipt.contractId);

  return { receiptId, ok: true };
}

export async function cancelReceipt(receiptId: string) {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: { allocations: true }
  });
  if (!receipt) throw new Error("Receipt not found");

  await prisma.$transaction(async (tx) => {
    const allocs = await tx.receiptAllocation.findMany({ where: { receiptId } });
    for (const a of allocs) {
      const inst = await tx.installment.findUnique({ where: { id: a.installmentId } });
      if (!inst) continue;
      const principalPaid = (inst as { principalPaid?: Prisma.Decimal }).principalPaid ?? new Prisma.Decimal(0);
      const interestPaid = (inst as { interestPaid?: Prisma.Decimal }).interestPaid ?? new Prisma.Decimal(0);
      const taxPaid = (inst as { taxPaid?: Prisma.Decimal }).taxPaid ?? new Prisma.Decimal(0);

      let newPrincipalPaid = principalPaid;
      let newInterestPaid = interestPaid;
      let newTaxPaid = taxPaid;
      let newLateFeeAccrued = new Prisma.Decimal(inst.lateFeeAccrued ?? 0);

      const comp = (a as any).component as string | undefined;
      if (comp === "PRINCIPAL") newPrincipalPaid = principalPaid.sub(a.amount);
      else if (comp === "INTEREST") newInterestPaid = interestPaid.sub(a.amount);
      else if (comp === "TAX") newTaxPaid = taxPaid.sub(a.amount);
      else if (comp === "LATE_FEE") newLateFeeAccrued = newLateFeeAccrued.add(a.amount);

      if (newPrincipalPaid.lt(0)) newPrincipalPaid = new Prisma.Decimal(0);
      if (newInterestPaid.lt(0)) newInterestPaid = new Prisma.Decimal(0);
      if (newTaxPaid.lt(0)) newTaxPaid = new Prisma.Decimal(0);

      const newPaid = newPrincipalPaid.add(newInterestPaid).add(newTaxPaid);
      const dueTotal = installmentTotalDue(inst);
      const nextStatus = installmentStatusFromPaid(dueTotal, newPaid);
      const prevStatus = inst.status as InstallmentStatus;
      const prevPaidAt = (inst as any).paidAt as Date | null | undefined;
      try {
        await tx.installment.update({
          where: { id: inst.id },
          data: {
            paidAmount: newPaid,
            principalPaid: newPrincipalPaid,
            interestPaid: newInterestPaid,
            taxPaid: newTaxPaid,
            lateFeeAccrued: newLateFeeAccrued,
            status: nextStatus,
            paidAt: paidAtFromTransition(prevStatus, nextStatus, prevPaidAt)
          } as any
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Unknown argument `paidAt`") || msg.includes("Unknown argument 'paidAt'")) {
          await tx.installment.update({
            where: { id: inst.id },
            data: {
              paidAmount: newPaid,
              principalPaid: newPrincipalPaid,
              interestPaid: newInterestPaid,
              taxPaid: newTaxPaid,
              lateFeeAccrued: newLateFeeAccrued,
              status: nextStatus
            } as any
          });
        } else {
          throw e;
        }
      }
    }
    await tx.receiptAllocation.deleteMany({ where: { receiptId } });
    try {
      await tx.receipt.update({
        where: { id: receiptId },
        data: { state: "CANCELLED" as ReceiptState, unallocatedAmount: new Prisma.Decimal(0) } as any
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Unknown argument `unallocatedAmount`") || msg.includes("Unknown argument 'unallocatedAmount'")) {
        await tx.receipt.update({
          where: { id: receiptId },
          data: { state: "CANCELLED" as ReceiptState } as any
        });
      } else {
        throw e;
      }
    }
  });

  await syncContractOverdueStatusForContract(receipt.contractId);

  return { receiptId, ok: true };
}
