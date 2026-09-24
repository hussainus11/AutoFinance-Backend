import { Router } from "express";
import { z } from "zod";
import { Prisma, type InstallmentType } from "@prisma/client";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { buildEmiSchedule, INSTALLMENT_MONTHS_STEP } from "../services/emi.js";
import { approveRestructureRequest } from "../services/restructure.js";
import { tenantConnectOrThrow } from "../services/tenant-helpers.js";
import { notifyUsers } from "../services/notifications.js";
import { getRequestContext } from "../context.js";

export const taskQueueRouter = Router();

const statusEnum = z.enum(["DRAFT", "APPROVED", "REJECTED", "MODIFICATION_REQUIRED"]);

const patchBody = z
  .object({
    status: statusEnum.optional(),
    notes: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    dueDate: z.string().datetime().optional().nullable(),
    priority: z.enum(["LOW", "NORMAL", "HIGH"]).optional(),
    assignedToUserId: z.string().uuid().optional().nullable(),
    rejectionReason: z.string().optional().nullable(),
    /** ISO datetime — first installment anchor (same as manual schedule). Only with status APPROVED. */
    scheduleStartDate: z.string().datetime().optional()
  })
  .superRefine((data, ctx) => {
    const hasField =
      data.status !== undefined ||
      data.notes !== undefined ||
      data.title !== undefined ||
      data.dueDate !== undefined ||
      data.priority !== undefined ||
      data.assignedToUserId !== undefined ||
      data.rejectionReason !== undefined ||
      data.scheduleStartDate !== undefined;
    if (!hasField) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "At least one field is required" });
    }
    if (data.scheduleStartDate !== undefined) {
      if (data.status !== "APPROVED") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "scheduleStartDate is only valid when status is APPROVED"
        });
      }
    }
  });

const assignedToInclude = { select: { id: true, email: true, name: true } };

function pickChartForDate(
  charts: Array<{
    chartType: string;
    isActive: boolean;
    startDate: Date;
    endDate: Date;
    priority: number;
    valueKind: string;
    value: Prisma.Decimal;
  }>,
  chartType: string,
  when: Date
) {
  const t = when.getTime();
  return (
    charts
      .filter((c) => c.chartType === chartType && c.isActive && c.startDate.getTime() <= t && c.endDate.getTime() >= t)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0] ?? null
  );
}

function calcChartAmount(
  chart: { valueKind: string; value: Prisma.Decimal },
  baseAmount: Prisma.Decimal
): Prisma.Decimal {
  if (chart.valueKind === "FIXED") return chart.value;
  // PERCENTAGE: chart.value is 0..100 (already validated on create/update)
  return baseAmount.mul(chart.value).div(100);
}

function metaUpdateFromBody(
  body: z.infer<typeof patchBody>
): Prisma.TaskQueueRequestUncheckedUpdateInput {
  const data: Prisma.TaskQueueRequestUncheckedUpdateInput = {};
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.title !== undefined) data.title = body.title;
  if (body.dueDate !== undefined) data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
  if (body.priority !== undefined) data.priority = body.priority;
  if (body.assignedToUserId !== undefined) data.assignedToUserId = body.assignedToUserId;
  if (body.rejectionReason !== undefined) data.rejectionReason = body.rejectionReason;
  return data;
}

const listInclude = {
  contract: {
    include: {
      buyer: true,
      agent: true,
      campaign: true,
      installments: true
    }
  },
  assignedTo: assignedToInclude
} satisfies Prisma.TaskQueueRequestInclude;

const detailInclude = {
  contract: {
    include: {
      buyer: true,
      agent: true,
      campaign: true,
      vehicles: { include: { vehicle: true } },
      guarantors: { include: { partner: true } },
      installments: true
    }
  },
  assignedTo: assignedToInclude
} satisfies Prisma.TaskQueueRequestInclude;

const TASK_STATUSES = new Set(["DRAFT", "APPROVED", "REJECTED", "MODIFICATION_REQUIRED"]);

function buildTaskQueueSearchWhere(q: string): Prisma.TaskQueueRequestWhereInput {
  const trimmed = q.trim();
  const or: Prisma.TaskQueueRequestWhereInput[] = [
    { title: { contains: trimmed, mode: "insensitive" } },
    { notes: { contains: trimmed, mode: "insensitive" } },
    { contract: { contractNumber: { contains: trimmed, mode: "insensitive" } } },
    { contract: { buyer: { displayName: { contains: trimmed, mode: "insensitive" } } } },
    { assignedTo: { name: { contains: trimmed, mode: "insensitive" } } },
    { assignedTo: { email: { contains: trimmed, mode: "insensitive" } } }
  ];
  const statusUpper = trimmed.toUpperCase();
  if (TASK_STATUSES.has(statusUpper)) {
    or.push({ status: statusUpper as Prisma.EnumTaskQueueStatusFilter["equals"] });
  }
  return { OR: or };
}

taskQueueRouter.get("/task-queue-requests", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const rows = await prisma.taskQueueRequest.findMany({
      where: q ? buildTaskQueueSearchWhere(q) : undefined,
      include: listInclude,
      orderBy: { createdAt: "desc" }
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

taskQueueRouter.get("/task-queue-requests/:id", async (req, res, next) => {
  try {
    const row = await prisma.taskQueueRequest.findUnique({
      where: { id: req.params.id },
      include: detailInclude
    });
    if (!row) return res.status(404).json({ error: "Task not found" });
    res.json(serialize(row));
  } catch (e) {
    next(e);
  }
});

taskQueueRouter.patch("/task-queue-requests/:id", async (req, res, next) => {
  try {
    const body = patchBody.parse(req.body);
    if (body.assignedToUserId) {
      const u = await prisma.user.findUnique({ where: { id: body.assignedToUserId } });
      if (!u) return res.status(400).json({ error: "Assigned user not found" });
    }

    const current = await prisma.taskQueueRequest.findUnique({
      where: { id: req.params.id },
      include: {
        contract: { include: { installments: true, vehicles: true } }
      }
    });
    if (!current) return res.status(404).json({ error: "Task not found" });

    const meta = metaUpdateFromBody(body);

    if (body.status === undefined) {
      const updated = await prisma.taskQueueRequest.update({
        where: { id: req.params.id },
        data: meta,
        include: detailInclude
      });

      if (body.assignedToUserId && body.assignedToUserId !== (current as any).assignedToUserId) {
        await notifyUsers({
          userIds: [body.assignedToUserId],
          type: "TASK_ASSIGNED",
          title: "Task assigned",
          message: updated.title ?? "A task has been assigned to you.",
          href: `/dashboard/autofinance/task-queue/${updated.id}`
        });
      }

      return res.json(serialize(updated));
    }

    if (body.status === "APPROVED") {
      const start = body.scheduleStartDate
        ? new Date(body.scheduleStartDate)
        : (() => {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            return d;
          })();

      await prisma.$transaction(async (tx) => {
        const contract = await tx.contract.findUnique({
          where: { id: current.contractId },
          include: { installments: true, vehicles: true, agent: true, campaign: true }
        });
        if (!contract) throw new Error("Contract not found");

        const requestType = (current as any).requestType as string | undefined;
        const restructureRequestId = (current as any).restructureRequestId as string | undefined;
        const recoveryCaseId = (current as any).recoveryCaseId as string | undefined;

        if (requestType === "CONTRACT_RESTRUCTURE") {
          if (!restructureRequestId) {
            throw new Error("Restructure request id missing on task");
          }
          // Approve restructure: move installments to history and regenerate schedule.
          await approveRestructureRequest(restructureRequestId);
        } else if (requestType === "RECOVERY_REPOSSESS") {
          if (!recoveryCaseId) throw new Error("Recovery case id missing on task");
          const rc = await tx.recoveryCase.findUnique({ where: { id: recoveryCaseId } });
          if (!rc) throw new Error("Recovery case not found");

          await tx.recoveryCase.update({
            where: { id: rc.id },
            data: {
              status: "REPOSSESSED",
              repoApprovedAt: new Date(),
              repoAt: rc.repoAt ?? new Date()
            } as any
          });

          // Real-world default: repossession is a recovery action, and the debt remains open.
          // Mark contract as DEFAULTED (but don't override terminal statuses).
          const curContract = await tx.contract.findUnique({
            where: { id: rc.contractId },
            select: { status: true }
          });
          if (curContract && curContract.status !== "COMPLETED" && curContract.status !== "CANCELLED") {
            await tx.contract.update({
              where: { id: rc.contractId },
              data: { status: "DEFAULTED" }
            });
          }

          // Update linked vehicles to REPOSSESSED (if any)
          const vids = (await tx.contractVehicle.findMany({ where: { contractId: rc.contractId } })).map((x) => x.vehicleId);
          if (vids.length) {
            await tx.vehicle.updateMany({ where: { id: { in: vids } }, data: { status: "REPOSSESSED" } as any });
          }

          await tx.recoveryCaseEvent.create({
            data: {
              case: { connect: { id: rc.id } },
              type: "REPO_APPROVED",
              note: "Repossession approved",
              company: { connect: { id: (getRequestContext()?.companyId as string) } }
            } as any
          });
        } else if (requestType === "RECOVERY_DISPOSE") {
          if (!recoveryCaseId) throw new Error("Recovery case id missing on task");
          const rc = await tx.recoveryCase.findUnique({ where: { id: recoveryCaseId } });
          if (!rc) throw new Error("Recovery case not found");

          await tx.recoveryCase.update({
            where: { id: rc.id },
            data: {
              status: "DISPOSED",
              disposedAt: rc.disposedAt ?? new Date()
            } as any
          });

          const vids = (await tx.contractVehicle.findMany({ where: { contractId: rc.contractId } })).map((x) => x.vehicleId);
          if (vids.length) {
            await tx.vehicle.updateMany({ where: { id: { in: vids } }, data: { status: "DISPOSED" } as any });
          }

          await tx.recoveryCaseEvent.create({
            data: {
              case: { connect: { id: rc.id } },
              type: "DISPOSAL_APPROVED",
              note: "Disposal approved",
              company: { connect: { id: (getRequestContext()?.companyId as string) } }
            } as any
          });
        } else if (requestType === "RECOVERY_CLOSE") {
          if (!recoveryCaseId) throw new Error("Recovery case id missing on task");
          const rc = await tx.recoveryCase.findUnique({ where: { id: recoveryCaseId } });
          if (!rc) throw new Error("Recovery case not found");

          await tx.recoveryCase.update({
            where: { id: rc.id },
            data: {
              status: "CLOSED",
              resolvedAt: new Date()
            } as any
          });

          await tx.recoveryCaseEvent.create({
            data: {
              case: { connect: { id: rc.id } },
              type: "CASE_CLOSED",
              note: current.notes ?? undefined,
              company: { connect: { id: (getRequestContext()?.companyId as string) } }
            } as any
          });
        } else if (contract.installments.length === 0) {
          const tenantCompanyId = getRequestContext()?.companyId ?? null;
          const tenantBranchId = getRequestContext()?.branchId ?? null;
          if (!tenantCompanyId) throw new Error("Missing tenant");

          const scheduleType =
            (contract as { installmentType?: InstallmentType }).installmentType ?? "MONTHLY";
          const timing = ((contract as any).installmentTiming as "ARREARS" | "ADVANCE" | undefined) ?? "ARREARS";
          const monthsStep = INSTALLMENT_MONTHS_STEP[scheduleType] ?? 1;
          const anchor = new Date(start);
          if (timing === "ADVANCE") {
            anchor.setMonth(anchor.getMonth() - monthsStep);
          }
          const rows = buildEmiSchedule(
            contract.principalAmount,
            contract.interestRateApr,
            contract.tenureMonths,
            anchor,
            scheduleType
          );
          await tx.installment.createMany({
            data: rows.map((r) => ({
              contractId: contract.id,
              companyId: tenantCompanyId,
              branchId: tenantBranchId,
              sequence: r.sequence,
              dueDate: r.dueDate,
              principalDue: r.principalDue,
              interestDue: r.interestDue,
              taxDue: new Prisma.Decimal(0),
              totalDue: r.totalDue,
              paidAmount: new Prisma.Decimal(0),
              principalPaid: new Prisma.Decimal(0),
              interestPaid: new Prisma.Decimal(0),
              taxPaid: new Prisma.Decimal(0),
              status: "PENDING" as const
            }))
          });
          await tx.contract.update({
            where: { id: contract.id },
            data: { status: "ACTIVE", startDate: start }
          });
          const vids = contract.vehicles.map((cv) => cv.vehicleId);
          if (vids.length) {
            await tx.vehicle.updateMany({
              where: { id: { in: vids } },
              data: { status: "FINANCED" }
            });
          }

          // Auto-generate Downpayment + Commission receipts on approval.
          // IMPORTANT: Use contract snapshots so later chart/campaign edits do NOT affect existing contracts.
          // These receipts are informational placeholders (not auto-allocated).
          {
            const tenant = tenantConnectOrThrow();

            const downPaymentRaw = (contract as any).downPaymentAmount ?? null;
            const downPaymentAmount =
              downPaymentRaw == null ? null : new Prisma.Decimal(String(downPaymentRaw));
            if (downPaymentAmount && downPaymentAmount.gt(0)) {
              const exists = await tx.receipt.findFirst({
                where: { contractId: contract.id, reference: "AUTO:DOWNPAYMENT" },
                select: { id: true }
              });
              if (!exists) {
                await tx.receipt.create({
                  data: {
                    contract: { connect: { id: contract.id } },
                    amount: downPaymentAmount,
                    receiptType: "DOWN_PAYMENT",
                    paymentMode: "DOWNPAYMENT",
                    reference: "AUTO:DOWNPAYMENT",
                    note: "Auto-generated on contract approval (snapshot downpayment)",
                    ...tenant
                  } as any
                });
              }
            }

            // Commission receipt is created if there is any commission payable for this contract.
            const commissions = await tx.commission.findMany({
              where: { contractId: contract.id },
              select: { amount: true, agent: { select: { displayName: true } } }
            });
            const commissionAmount = commissions.reduce(
              (sum: Prisma.Decimal, r: any) => sum.add(r.amount ?? new Prisma.Decimal(0)),
              new Prisma.Decimal(0)
            );
            if (commissionAmount.gt(0)) {
              const exists = await tx.receipt.findFirst({
                where: { contractId: contract.id, reference: "AUTO:COMMISSION" },
                select: { id: true }
              });
              if (!exists) {
                const agentNames = Array.from(
                  new Set((commissions ?? []).map((r: any) => String(r.agent?.displayName ?? "").trim()).filter(Boolean))
                );
                await tx.receipt.create({
                  data: {
                    contract: { connect: { id: contract.id } },
                    amount: commissionAmount,
                    receiptType: "COMMISSION",
                    paymentMode: "COMMISSION",
                    reference: "AUTO:COMMISSION",
                    note: `Auto-generated on contract approval (commission). Agent: ${agentNames.join(", ") || "—"}`,
                    ...tenant
                  } as any
                });

                // Treat commission as an expense (accrual) while keeping a receipt/voucher record.
                // This ensures dashboards and expense reports reflect commission correctly.
                const expenseRef = `AUTO:COMMISSION:${contract.id}`;
                const expExists = await tx.expense.findFirst({
                  where: { reference: expenseRef, companyId: tenant.company.connect.id } as any,
                  select: { id: true }
                });
                if (!expExists) {
                  // Ensure a "Commission" category exists for this tenant.
                  const cat = await tx.expenseCategory.upsert({
                    where: { companyId_name: { companyId: tenant.company.connect.id, name: "Commission" } } as any,
                    create: {
                      name: "Commission",
                      isActive: true,
                      ...tenant
                    } as any,
                    update: {} as any
                  });
                  await tx.expense.create({
                    data: {
                      amount: commissionAmount,
                      expenseDate: start,
                      description: "Agent commission (accrued on contract approval)",
                      vendor: agentNames.join(", ") || null,
                      reference: expenseRef,
                      paymentMode: "ACCRUAL",
                      category: { connect: { id: cat.id } },
                      ...tenant
                    } as any
                  });
                }
              }
            }
          }
        }

        const approvedData: Prisma.TaskQueueRequestUncheckedUpdateInput = {
          ...meta,
          status: "APPROVED",
          completedAt: new Date(),
          rejectionReason: null
        };
        await tx.taskQueueRequest.update({
          where: { id: req.params.id },
          data: approvedData
        });
      });

      const updated = await prisma.taskQueueRequest.findUnique({
        where: { id: req.params.id },
        include: detailInclude
      });
      return res.json(serialize(updated));
    }

    const terminalData: Prisma.TaskQueueRequestUncheckedUpdateInput = {
      status: body.status,
      ...meta
    };
    if (body.status === "REJECTED") {
      terminalData.completedAt = new Date();
    }
    if (body.status === "MODIFICATION_REQUIRED") {
      terminalData.completedAt = null;
    }

    const updated = await prisma.taskQueueRequest.update({
      where: { id: req.params.id },
      data: terminalData,
      include: detailInclude
    });
    res.json(serialize(updated));
  } catch (e) {
    next(e);
  }
});
