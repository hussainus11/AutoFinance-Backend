import { Prisma, type WaiverValueKind } from "@prisma/client";
import { prisma } from "../prisma.js";

export type ApplyLateFeeWaiverInput = {
  installmentId: string;
  valueKind: WaiverValueKind;
  /** Positive decimal string or number */
  value: string | number;
};

function parsePositiveDecimal(raw: string | number): Prisma.Decimal {
  const s = typeof raw === "number" ? String(raw) : String(raw).trim();
  const d = new Prisma.Decimal(s);
  if (!d.isFinite() || d.lte(0)) {
    throw new Error("Value must be a positive number");
  }
  return d;
}

/**
 * Reduces `lateFeeAccrued` on one installment and records a waiver row.
 * Only contracts in OVERDUE status (delinquent portfolio) may use this.
 */
export async function applyLateFeeWaiver(contractId: string, input: ApplyLateFeeWaiverInput) {
  return prisma.$transaction(async (tx) => {
    if (typeof (tx as unknown as { lateFeeWaiver?: unknown }).lateFeeWaiver === "undefined") {
      throw new Error("Prisma client is out of date (lateFeeWaiver missing). Run `npx prisma generate` and restart.");
    }
    const contract = await tx.contract.findUnique({
      where: { id: contractId },
      select: { id: true, status: true }
    });
    if (!contract) throw new Error("Contract not found");
    if (contract.status !== "OVERDUE") {
      throw new Error("Late fee waivers are only available when the contract status is Overdue");
    }

    const inst = await tx.installment.findFirst({
      where: { id: input.installmentId, contractId }
    });
    if (!inst) throw new Error("Installment not found on this contract");

    const late = new Prisma.Decimal(inst.lateFeeAccrued ?? 0);
    if (late.lte(0)) throw new Error("This installment has no accrued late fee to waive");

    const inputVal = parsePositiveDecimal(input.value);
    let waive: Prisma.Decimal;

    if (input.valueKind === "FIXED") {
      waive = Prisma.Decimal.min(inputVal, late);
    } else {
      if (inputVal.gt(100)) {
        throw new Error("Percentage cannot exceed 100");
      }
      waive = late.mul(inputVal).div(100).toDecimalPlaces(2);
      if (waive.gt(late)) waive = late;
    }

    if (waive.lte(0)) throw new Error("Calculated waiver amount is zero");

    const newLate = late.sub(waive);
    await tx.installment.update({
      where: { id: inst.id },
      data: { lateFeeAccrued: newLate }
    });

    const row = await tx.lateFeeWaiver.create({
      data: {
        contractId,
        installmentId: inst.id,
        valueKind: input.valueKind,
        inputValue: inputVal,
        amountWaived: waive
      }
    });

    return row;
  });
}
