import { prisma } from "../prisma.js";
import { runOverdueLateFeeJob } from "./overdue-penalty.js";
import { runInstallmentWhatsAppReminderJob } from "./installment-reminders.js";

const CFG_ENABLED = "process.overduePenalty.enabled";
const CFG_HOUR = "process.overduePenalty.hour";
const CFG_MINUTE = "process.overduePenalty.minute";

const REM_ENABLED = "process.installmentReminder.enabled";
const REM_HOUR = "process.installmentReminder.hour";
const REM_MINUTE = "process.installmentReminder.minute";

/** Fires at most once per local server clock minute (per company) when hour/minute match. */
const lastScheduledSlotByCompany = new Map<string, string>();
const lastReminderSlotByCompany = new Map<string, string>();

export function startProcessScheduler(): void {
  const intervalMs = 30_000;

  const tick = async () => {
    try {
      const companies = await prisma.company.findMany({ select: { id: true } });
      const now = new Date();

      for (const { id: companyId } of companies) {
        const rows = await prisma.systemConfig.findMany({
          where: { companyId, key: { in: [CFG_ENABLED, CFG_HOUR, CFG_MINUTE, REM_ENABLED, REM_HOUR, REM_MINUTE] } }
        });
        const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

        if (map[CFG_ENABLED] === "true") {
          const hour = Math.min(23, Math.max(0, Number(map[CFG_HOUR] ?? "2")));
          const minute = Math.min(59, Math.max(0, Number(map[CFG_MINUTE] ?? "0")));
          if (now.getHours() === hour && now.getMinutes() === minute) {
            const slot = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${hour}-${minute}`;
            if (lastScheduledSlotByCompany.get(companyId) !== slot) {
              lastScheduledSlotByCompany.set(companyId, slot);
              await runOverdueLateFeeJob("SCHEDULED", companyId);
            }
          }
        }

        if (map[REM_ENABLED] === "true") {
          const hour = Math.min(23, Math.max(0, Number(map[REM_HOUR] ?? "9")));
          const minute = Math.min(59, Math.max(0, Number(map[REM_MINUTE] ?? "0")));
          if (now.getHours() === hour && now.getMinutes() === minute) {
            const slot = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${hour}-${minute}`;
            if (lastReminderSlotByCompany.get(companyId) !== slot) {
              lastReminderSlotByCompany.set(companyId, slot);
              await runInstallmentWhatsAppReminderJob("SCHEDULED", companyId);
            }
          }
        }
      }
    } catch (e) {
      console.error("[process-scheduler] scheduled jobs failed", e);
    }
  };

  setInterval(() => {
    void tick();
  }, intervalMs);
}
