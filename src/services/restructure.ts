import { Prisma, type InstallmentType } from "@prisma/client";
import { prisma } from "../prisma.js";
import { buildEmiSchedule, INSTALLMENT_MONTHS_STEP } from "./emi.js";
import { tenantConnectOrThrow } from "./tenant-helpers.js";
import { getRequestContext } from "../context.js";

function addMonthsLocal(d: Date, months: number): Date {
  const next = new Date(d);
  const day = next.getDate();
  next.setMonth(next.getMonth() + months);
  // Preserve day-of-month when possible; JS Date will roll over for shorter months.
  // If rollover happened (e.g. 31st → next month), we accept the JS behavior as the system standard.
  if (next.getDate() !== day) {
    // no-op; documented behavior
  }
  return next;
}

export async function createRestructureRequest(contractId: string, pivotInstallmentId: string, startDueDate: Date) {
  if (typeof (prisma as unknown as { restructureRequest?: unknown }).restructureRequest === "undefined") {
    throw new Error("Prisma client is out of date (restructureRequest missing). Run `npx prisma generate` and restart.");
  }

  // Prevent multiple concurrent restructure tasks for the same contract.
  // Business rule: while a restructure task is in DRAFT or MODIFICATION_REQUIRED, block new requests.
  const existingTask = await prisma.taskQueueRequest.findFirst({
    where: {
      contractId,
      requestType: "CONTRACT_RESTRUCTURE",
      status: { in: ["DRAFT", "MODIFICATION_REQUIRED"] }
    },
    select: { id: true, status: true }
  });
  if (existingTask) {
    throw new Error(
      `A restructure request already exists for this contract (${existingTask.status}). Please complete/review it in Task Queue first.`
    );
  }

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { installments: { orderBy: { sequence: "asc" } } }
  });
  if (!contract) throw new Error("Contract not found");
  const pivot = contract.installments.find((i) => i.id === pivotInstallmentId);
  if (!pivot) throw new Error("Pivot installment not found on this contract");

  if (Number.isNaN(startDueDate.getTime())) throw new Error("Invalid start due date");

  // Reschedule due dates from the pivot installment through the last installment.
  const installmentType = (contract.installmentType ?? "MONTHLY") as InstallmentType;
  const step = INSTALLMENT_MONTHS_STEP[installmentType];
  const remaining = contract.installments.filter((i) => i.sequence >= pivot.sequence);
  await prisma.$transaction(async (tx) => {
    for (let idx = 0; idx < remaining.length; idx++) {
      const inst = remaining[idx];
      const nextDue = addMonthsLocal(startDueDate, idx * step);
      await tx.installment.update({
        where: { id: inst.id },
        data: { dueDate: nextDue }
      });
    }
  });

  const tenant = tenantConnectOrThrow();
  const row = await (prisma as any).restructureRequest.create({
    data: {
      ...tenant,
      contract: { connect: { id: contractId } },
      pivotInstallmentId,
      pivotSequence: pivot.sequence
    }
  });

  // Create an approval task in Task Queue (multiple per contract allowed).
  await prisma.taskQueueRequest.create({
    data: {
      ...tenant,
      contract: { connect: { id: contract.id } },
      requestType: "CONTRACT_RESTRUCTURE",
      restructureRequestId: row.id,
      status: "DRAFT",
      title: `Restructure: ${contract.contractNumber}`,
      notes: `Pivot installment: EMI #${pivot.sequence} rescheduled to ${startDueDate.toISOString()}`
    } as any
  });

  return row;
}

/**
 * Approve: move current installments to history and regenerate a new schedule
 * starting from the pivot installment (inclusive).
 */
export async function approveRestructureRequest(requestId: string) {
  return prisma.$transaction(async (tx) => {
    if (typeof (tx as unknown as { restructureRequest?: unknown }).restructureRequest === "undefined") {
      throw new Error("Prisma client is out of date (restructureRequest missing). Run `npx prisma generate` and restart.");
    }
    if (typeof (tx as unknown as { installmentHistory?: unknown }).installmentHistory === "undefined") {
      throw new Error("Prisma client is out of date (installmentHistory missing). Run `npx prisma generate` and restart.");
    }

    const req = await (tx as any).restructureRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new Error("Restructure request not found");
    if (req.status !== "PENDING") throw new Error("Restructure request is already processed");

    const contract = await tx.contract.findUnique({
      where: { id: req.contractId },
      include: { installments: { orderBy: { sequence: "asc" } } }
    });
    if (!contract) throw new Error("Contract not found");
    if (contract.installments.length === 0) throw new Error("No installments to restructure");

    const pivot = contract.installments.find((i) => i.id === req.pivotInstallmentId);
    if (!pivot) throw new Error("Pivot installment not found on this contract");

    // IMPORTANT: Prisma extensions in `src/prisma.ts` auto-inject tenant/audit for `create`,
    // but `createMany` does NOT go through that path. InstallmentHistory requires companyId.
    const tenantCompanyId = getRequestContext()?.companyId ?? null;
    const tenantBranchId = getRequestContext()?.branchId ?? null;
    if (!tenantCompanyId) throw new Error("Missing tenant");

    // Move all installments to history
    await (tx as any).installmentHistory.createMany({
      data: contract.installments.map((i) => ({
        companyId: tenantCompanyId,
        branchId: tenantBranchId,
        contractId: contract.id,
        restructureRequestId: req.id,
        sequence: i.sequence,
        dueDate: i.dueDate,
        principalDue: i.principalDue,
        interestDue: i.interestDue,
        taxDue: (i as any).taxDue ?? new Prisma.Decimal(0),
        totalDue: i.totalDue,
        paidAmount: i.paidAmount,
        principalPaid: (i as any).principalPaid ?? new Prisma.Decimal(0),
        interestPaid: (i as any).interestPaid ?? new Prisma.Decimal(0),
        taxPaid: (i as any).taxPaid ?? new Prisma.Decimal(0),
        status: i.status,
        lateFeeAccrued: new Prisma.Decimal(i.lateFeeAccrued ?? 0),
        lastLateFeeRunAt: i.lastLateFeeRunAt ?? null
      })) as any
    });

    // Delete installments from pivot onward (fresh schedule will be created),
    // but keep installments before pivot (usually already paid) intact.
    await tx.installment.deleteMany({
      where: {
        contractId: contract.id,
        sequence: { gte: pivot.sequence }
      }
    });

    const installmentType = (contract.installmentType ?? "MONTHLY") as InstallmentType;
    const step = INSTALLMENT_MONTHS_STEP[installmentType];

    const remaining = contract.installments.filter((i) => i.sequence >= pivot.sequence);
    const remainingCount = remaining.length;
    if (remainingCount <= 0) throw new Error("No remaining installments to restructure from pivot");
    const tenureMonths = remainingCount * step;

    // Remaining principal to re-amortize (simple rule).
    const remainingPrincipal = remaining.reduce((s, i) => {
      const paid = (i as any).principalPaid ?? new Prisma.Decimal(0);
      const out = i.principalDue.sub(paid);
      return s.add(out.gt(0) ? out : new Prisma.Decimal(0));
    }, new Prisma.Decimal(0));

    // Anchor so first new dueDate matches pivot dueDate.
    const anchor = new Date(pivot.dueDate);
    anchor.setMonth(anchor.getMonth() - step);

    const schedule = buildEmiSchedule(
      remainingPrincipal,
      new Prisma.Decimal(contract.interestRateApr),
      tenureMonths,
      anchor,
      installmentType
    );

    await tx.installment.createMany({
      data: schedule.map((r, idx) => ({
        companyId: tenantCompanyId,
        branchId: tenantBranchId,
        contractId: contract.id,
        sequence: pivot.sequence + idx,
        dueDate: r.dueDate,
        principalDue: r.principalDue,
        interestDue: r.interestDue,
        taxDue: new Prisma.Decimal(0),
        totalDue: r.totalDue,
        paidAmount: new Prisma.Decimal(0),
        principalPaid: new Prisma.Decimal(0),
        interestPaid: new Prisma.Decimal(0),
        taxPaid: new Prisma.Decimal(0),
        status: "PENDING" as const,
        lateFeeAccrued: new Prisma.Decimal(0),
        lastLateFeeRunAt: null
      })) as any
    });

    const updatedReq = await (tx as any).restructureRequest.update({
      where: { id: req.id },
      data: { status: "APPROVED", approvedAt: new Date() }
    });

    return updatedReq;
  });
}

