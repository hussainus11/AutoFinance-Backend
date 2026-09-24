import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { buildEmiSchedule, installmentPeriodCount, paymentsPerYear } from "./emi.js";

describe("paymentsPerYear", () => {
  it("maps installment type to periods per year", () => {
    expect(paymentsPerYear("MONTHLY")).toBe(12);
    expect(paymentsPerYear("QUARTERLY")).toBe(4);
    expect(paymentsPerYear("SEMI_ANNUAL")).toBe(2);
    expect(paymentsPerYear("YEARLY")).toBe(1);
  });
});

describe("installmentPeriodCount", () => {
  it("computes period count for tenures divisible by the type's month step", () => {
    expect(installmentPeriodCount(12, "MONTHLY")).toBe(12);
    expect(installmentPeriodCount(12, "QUARTERLY")).toBe(4);
    expect(installmentPeriodCount(24, "SEMI_ANNUAL")).toBe(4);
  });

  it("returns 0 for non-positive or incompatible tenures", () => {
    expect(installmentPeriodCount(0, "MONTHLY")).toBe(0);
    expect(installmentPeriodCount(-5, "MONTHLY")).toBe(0);
    expect(installmentPeriodCount(13, "QUARTERLY")).toBe(0);
  });
});

describe("buildEmiSchedule", () => {
  it("returns an empty schedule for an incompatible tenure", () => {
    const rows = buildEmiSchedule(
      new Prisma.Decimal(1000),
      new Prisma.Decimal(10),
      5,
      new Date(2025, 0, 1),
      "QUARTERLY"
    );
    expect(rows).toEqual([]);
  });

  it("produces N sequential rows with due dates advancing by the period step", () => {
    const start = new Date(2025, 0, 1); // Jan 2025, local time throughout (matches implementation)
    const rows = buildEmiSchedule(new Prisma.Decimal(12000), new Prisma.Decimal(12), 12, start, "MONTHLY");
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(rows[0].dueDate.getMonth()).toBe(1); // Feb (start + 1 month)
    expect(rows[11].dueDate.getMonth()).toBe(0); // Dec 2025 -> Jan 2026
    expect(rows[11].dueDate.getFullYear()).toBe(2026);
  });

  it("fully amortizes the principal by the final installment", () => {
    const rows = buildEmiSchedule(new Prisma.Decimal(10000), new Prisma.Decimal(9.99), 24, new Date(2025, 0, 1), "MONTHLY");
    const totalPrincipalPaid = rows.reduce((sum, r) => sum.add(r.principalDue), new Prisma.Decimal(0));
    expect(totalPrincipalPaid.toFixed(2)).toBe("10000.00");
  });

  it("charges zero interest when APR is 0 (equal principal installments)", () => {
    const rows = buildEmiSchedule(new Prisma.Decimal(1200), new Prisma.Decimal(0), 12, new Date(2025, 0, 1), "MONTHLY");
    for (const r of rows) {
      expect(r.interestDue.toFixed(2)).toBe("0.00");
    }
    const totalPrincipalPaid = rows.reduce((sum, r) => sum.add(r.principalDue), new Prisma.Decimal(0));
    expect(totalPrincipalPaid.toFixed(2)).toBe("1200.00");
  });

  it("keeps totalDue equal to principalDue + interestDue for every row", () => {
    const rows = buildEmiSchedule(new Prisma.Decimal(5000), new Prisma.Decimal(15), 6, new Date(2025, 5, 15), "MONTHLY");
    for (const r of rows) {
      expect(r.totalDue.toFixed(2)).toBe(r.principalDue.add(r.interestDue).toFixed(2));
    }
  });
});
