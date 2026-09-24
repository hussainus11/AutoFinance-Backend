import { Prisma, type InstallmentType } from "@prisma/client";

export type ScheduleRow = {
  sequence: number;
  dueDate: Date;
  principalDue: Prisma.Decimal;
  interestDue: Prisma.Decimal;
  totalDue: Prisma.Decimal;
};

/** Whole months between installment due dates. */
export const INSTALLMENT_MONTHS_STEP: Record<InstallmentType, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMI_ANNUAL: 6,
  YEARLY: 12
};

/** Number of payment periods per calendar year for the given schedule type. */
export function paymentsPerYear(installmentType: InstallmentType): number {
  return 12 / INSTALLMENT_MONTHS_STEP[installmentType];
}

/** Count of installments for a tenure in months; 0 if tenure is not compatible. */
export function installmentPeriodCount(
  tenureMonths: number,
  installmentType: InstallmentType
): number {
  const step = INSTALLMENT_MONTHS_STEP[installmentType];
  if (tenureMonths <= 0 || tenureMonths % step !== 0) return 0;
  return tenureMonths / step;
}

/**
 * Reducing-balance EMI schedule. APR is nominal annual; each period uses APR / (payments per year).
 * Due dates advance by `INSTALLMENT_MONTHS_STEP[installmentType]` months from the anchor.
 */
export function buildEmiSchedule(
  principal: Prisma.Decimal,
  annualRateApr: Prisma.Decimal,
  tenureMonths: number,
  startDate: Date,
  installmentType: InstallmentType = "MONTHLY"
): ScheduleRow[] {
  const n = installmentPeriodCount(tenureMonths, installmentType);
  const monthsStep = INSTALLMENT_MONTHS_STEP[installmentType];

  if (n <= 0) return [];

  const P = principal.toNumber();
  const annual = annualRateApr.toNumber();
  const ppy = paymentsPerYear(installmentType);
  const r = annual / 100 / ppy;

  let emi: number;
  if (r === 0) {
    emi = P / n;
  } else {
    const pow = Math.pow(1 + r, n);
    emi = (P * r * pow) / (pow - 1);
  }

  const rows: ScheduleRow[] = [];
  let balance = P;

  for (let i = 1; i <= n; i++) {
    const interest = balance * r;
    let principalPmt = emi - interest;
    if (i === n) {
      principalPmt = balance;
    }
    if (principalPmt > balance) principalPmt = balance;

    const due = new Date(startDate);
    due.setMonth(due.getMonth() + i * monthsStep);

    const intDec = new Prisma.Decimal(interest.toFixed(2));
    const prDec = new Prisma.Decimal(principalPmt.toFixed(2));
    const totDec = prDec.add(intDec);

    rows.push({
      sequence: i,
      dueDate: due,
      principalDue: prDec,
      interestDue: intDec,
      totalDue: totDec
    });

    balance -= principalPmt;
    if (balance < 0.0001) balance = 0;
  }

  return rows;
}
