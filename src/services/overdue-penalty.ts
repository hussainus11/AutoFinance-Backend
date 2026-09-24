import { Prisma, type FinanceChart } from "@prisma/client";
import { prisma } from "../prisma.js";
import { markOverdueInstallmentsForTenant } from "./collections.js";

export const OVERDUE_LATE_FEE_JOB = "OVERDUE_LATE_FEE";

export type OverdueLateFeeSummary = {
  overdueStatusesUpdated: boolean;
  installmentsScanned: number;
  lateFeeAccruals: number;
  skippedNoCampaign: number;
  skippedNoChart: number;
  skippedSameDay: number;
  skippedZeroOutstanding: number;
  contracts: Array<{
    contractId: string;
    contractNumber: string;
    lateFeePosted: string;
    installmentRows: number;
  }>;
};

function pickLatePaymentChart(
  charts: { chart: FinanceChart }[],
  asOf: Date
): FinanceChart | null {
  const candidates = charts
    .map((c) => c.chart)
    .filter(
      (ch) =>
        ch.chartType === "LATE_PAYMENT_FEE" &&
        ch.isActive &&
        asOf.getTime() >= ch.startDate.getTime() &&
        asOf.getTime() <= ch.endDate.getTime()
    );
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0] ?? null;
}

function computeFeeIncrement(
  outstanding: Prisma.Decimal,
  chart: FinanceChart,
  salePrice: Prisma.Decimal
): Prisma.Decimal {
  if (chart.valueKind === "FIXED") {
    return new Prisma.Decimal(chart.value);
  }
  const base = salePrice.gt(0) ? salePrice : outstanding;
  return base.mul(new Prisma.Decimal(chart.value)).div(100);
}

/**
 * Marks overdue rows, then posts late fees for ACTIVE contracts using each campaign's
 * LATE_PAYMENT_FEE chart (same rules as Finance Charts). At most one accrual per installment per UTC day.
 */
export async function runOverdueLateFeeJob(
  trigger: "SCHEDULED" | "MANUAL",
  companyId: string,
  branchId?: string | null
): Promise<OverdueLateFeeSummary> {
  const runAt = new Date();
  try {
    return await runOverdueLateFeeJobInner(trigger, runAt, companyId, branchId ?? null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      await prisma.processRun.create({
        data: {
          companyId,
          branchId: branchId ?? null,
          jobType: OVERDUE_LATE_FEE_JOB,
          status: "FAILED",
          trigger,
          startedAt: runAt,
          finishedAt: new Date(),
          message: msg
        }
      });
    } catch (logErr) {
      console.error("[overdue-late-fee] failed to record FAILED process run (original error below)", logErr);
    }
    throw e;
  }
}

async function runOverdueLateFeeJobInner(
  trigger: "SCHEDULED" | "MANUAL",
  runAt: Date,
  companyId: string,
  branchId: string | null
): Promise<OverdueLateFeeSummary> {
  await markOverdueInstallmentsForTenant({ companyId, branchId });

  const runDayUtc = runAt.toISOString().slice(0, 10);

  const rows = await prisma.installment.findMany({
    where: {
      status: "OVERDUE",
      contract: {
        status: { in: ["ACTIVE", "OVERDUE"] },
        companyId,
        ...(branchId ? { branchId } : {})
      }
    },
    include: {
      contract: {
        include: {
          campaign: {
            include: { charts: { include: { chart: true } } }
          },
          vehicles: { take: 1 }
        }
      }
    }
  });

  const summary: OverdueLateFeeSummary = {
    overdueStatusesUpdated: true,
    installmentsScanned: rows.length,
    lateFeeAccruals: 0,
    skippedNoCampaign: 0,
    skippedNoChart: 0,
    skippedSameDay: 0,
    skippedZeroOutstanding: 0,
    contracts: []
  };

  const byContract = new Map<
    string,
    { contractNumber: string; lateFeePosted: Prisma.Decimal; installmentRows: number }
  >();

  for (const inst of rows) {
    const contract = inst.contract;

    const outstanding = new Prisma.Decimal(inst.totalDue).sub(new Prisma.Decimal(inst.paidAmount));
    if (outstanding.lte(0)) {
      summary.skippedZeroOutstanding++;
      continue;
    }

    if (!contract.campaignId || !contract.campaign) {
      summary.skippedNoCampaign++;
      continue;
    }

    const chart = pickLatePaymentChart(contract.campaign.charts, runAt);
    if (!chart) {
      summary.skippedNoChart++;
      continue;
    }

    if (inst.lastLateFeeRunAt) {
      const lastDay = inst.lastLateFeeRunAt.toISOString().slice(0, 10);
      if (lastDay === runDayUtc) {
        summary.skippedSameDay++;
        continue;
      }
    }

    const salePrice =
      contract.vehicles[0]?.salePrice != null
        ? new Prisma.Decimal(contract.vehicles[0].salePrice)
        : new Prisma.Decimal(0);

    const increment = computeFeeIncrement(outstanding, chart, salePrice);
    if (increment.lte(0)) continue;

    const prevAccrued = new Prisma.Decimal(inst.lateFeeAccrued ?? 0);
    const newAccrued = prevAccrued.add(increment);

    await prisma.installment.update({
      where: { id: inst.id },
      data: {
        lateFeeAccrued: newAccrued,
        lastLateFeeRunAt: runAt
      }
    });

    summary.lateFeeAccruals++;
    const key = contract.id;
    const existing = byContract.get(key);
    if (existing) {
      existing.lateFeePosted = existing.lateFeePosted.add(increment);
      existing.installmentRows += 1;
    } else {
      byContract.set(key, {
        contractNumber: contract.contractNumber,
        lateFeePosted: increment,
        installmentRows: 1
      });
    }
  }

  summary.contracts = [...byContract.entries()].map(([contractId, v]) => ({
    contractId,
    contractNumber: v.contractNumber,
    lateFeePosted: v.lateFeePosted.toFixed(2),
    installmentRows: v.installmentRows
  }));

  await prisma.processRun.create({
    data: {
      companyId,
      branchId: branchId ?? null,
      jobType: OVERDUE_LATE_FEE_JOB,
      status: "SUCCESS",
      trigger,
      startedAt: runAt,
      finishedAt: new Date(),
      summaryJson: JSON.stringify(summary)
    }
  });

  return summary;
}
