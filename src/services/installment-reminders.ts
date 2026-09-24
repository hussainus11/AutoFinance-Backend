import { prisma } from "../prisma.js";
import { getMetaWhatsAppBranchConfigOrNull, sendWhatsAppTemplateViaMeta } from "./meta-whatsapp.js";

function utcDateKey(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function addUtcDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function parseDaysCsv(v: string | null | undefined): number[] {
  const raw = (v ?? "").trim();
  if (!raw) return [0];
  const nums = raw
    .split(",")
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 365);
  const uniq = Array.from(new Set(nums));
  uniq.sort((a, b) => a - b);
  return uniq.length ? uniq : [0];
}

export async function runInstallmentWhatsAppReminderJob(
  trigger: "SCHEDULED" | "MANUAL",
  companyId: string,
  branchId?: string | null
): Promise<{ scanned: number; remindersQueued: number; remindersSent: number; skippedNoTo: number; skippedNoFrom: number }> {
  const rows = await prisma.systemConfig.findMany({
    where: {
      companyId,
      key: {
        in: [
          "process.installmentReminder.enabled",
          "process.installmentReminder.daysBeforeDueCsv"
        ]
      }
    }
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  if (map["process.installmentReminder.enabled"] !== "true") {
    return { scanned: 0, remindersQueued: 0, remindersSent: 0, skippedNoTo: 0, skippedNoFrom: 0 };
  }

  const daysBefore = parseDaysCsv(map["process.installmentReminder.daysBeforeDueCsv"]);

  const now = new Date();
  const runDate = utcDateKey(now);

  // For each offset (days before due), we look ahead and match dueDate to that day (UTC day window).
  const windows = daysBefore.map((d) => {
    const dueDay = addUtcDays(startOfUtcDay(now), d);
    const from = dueDay;
    const to = addUtcDays(dueDay, 1);
    return { daysBefore: d, from, to };
  });

  const processRun = await prisma.processRun.create({
    data: {
      companyId,
      branchId: branchId ?? null,
      jobType: "INSTALLMENT_WHATSAPP_REMINDER",
      status: "RUNNING",
      trigger
    }
  });

  let scanned = 0;
  let remindersQueued = 0;
  let remindersSent = 0;
  let skippedNoTo = 0;
  let skippedNoFrom = 0;

  try {
    for (const w of windows) {
      const dueInstallments = await prisma.installment.findMany({
        where: {
          dueDate: { gte: w.from, lt: w.to },
          status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
          contract: {
            companyId,
            ...(branchId ? { branchId } : {})
          }
        },
        include: {
          contract: {
            include: {
              company: true,
              branch: true,
              buyer: {
                include: {
                  phones: true
                }
              }
            }
          }
        }
      });

      scanned += dueInstallments.length;

      for (const inst of dueInstallments as any[]) {
        const branchId: string | null = inst.contract?.branchId ?? null;
        const companyId: string | null = inst.contract?.companyId ?? null;
        if (!branchId || !companyId) {
          skippedNoFrom += 1;
          continue;
        }

        const buyer = inst.contract?.buyer;
        const phones = (buyer?.phones ?? []) as Array<{ phoneNumber: string; phoneType: string; isPrimary: boolean }>;
        const wa = phones.find((p) => p.phoneType === "WHATSAPP" && p.isPrimary)?.phoneNumber
          ?? phones.find((p) => p.phoneType === "WHATSAPP")?.phoneNumber
          ?? buyer?.phone
          ?? "";

        if (!wa) {
          skippedNoTo += 1;
          continue;
        }

        const metaCfg = await getMetaWhatsAppBranchConfigOrNull({ companyId, branchId });
        if (!metaCfg) {
          skippedNoFrom += 1;
          continue;
        }

        remindersQueued += 1;

        // De-dupe at DB level (unique constraint). If it already exists, skip sending.
        const existing = await prisma.installmentReminderLog.findUnique({
          where: {
            installmentId_runDate_daysBefore_channel: {
              installmentId: inst.id,
              runDate,
              daysBefore: w.daysBefore,
              channel: "WHATSAPP"
            }
          }
        });
        if (existing) continue;

        const due = inst.dueDate instanceof Date ? inst.dueDate : new Date(inst.dueDate);
        const dueShort = Number.isNaN(due.getTime()) ? "" : due.toLocaleDateString();
        const contractNumber = inst.contract?.contractNumber ?? "—";
        const amountDue = String(inst.totalDue ?? "");
        const templateParams = [
          String(inst.sequence ?? ""),
          dueShort,
          contractNumber,
          amountDue
        ];

        try {
          await sendWhatsAppTemplateViaMeta({
            accessToken: metaCfg.accessToken,
            phoneNumberId: metaCfg.phoneNumberId,
            to: wa,
            templateName: metaCfg.templateName,
            language: metaCfg.language,
            bodyParams: templateParams
          });
          await prisma.installmentReminderLog.create({
            data: {
              companyId,
              branchId,
              contractId: inst.contractId,
              installmentId: inst.id,
              runDate,
              daysBefore: w.daysBefore,
              channel: "WHATSAPP",
              toNumber: wa,
              message: `template:${metaCfg.templateName} params:${JSON.stringify(templateParams)}`,
              status: "SENT"
            }
          });
          remindersSent += 1;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await prisma.installmentReminderLog.create({
            data: {
              companyId,
              branchId,
              contractId: inst.contractId,
              installmentId: inst.id,
              runDate,
              daysBefore: w.daysBefore,
              channel: "WHATSAPP",
              toNumber: wa,
              message: `template:${metaCfg.templateName} params:${JSON.stringify(templateParams)}`,
              status: "FAILED",
              error: msg
            }
          });
        }
      }
    }

    await prisma.processRun.update({
      where: { id: processRun.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        summaryJson: JSON.stringify({ scanned, remindersQueued, remindersSent, skippedNoTo, skippedNoFrom, daysBefore })
      }
    });
  } catch (e) {
    await prisma.processRun.update({
      where: { id: processRun.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        message: e instanceof Error ? e.message : String(e),
        summaryJson: JSON.stringify({ scanned, remindersQueued, remindersSent, skippedNoTo, skippedNoFrom, daysBefore })
      }
    });
    throw e;
  }

  return { scanned, remindersQueued, remindersSent, skippedNoTo, skippedNoFrom };
}

