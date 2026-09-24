import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { runOverdueLateFeeJob } from "../services/overdue-penalty.js";
import { runInstallmentWhatsAppReminderJob } from "../services/installment-reminders.js";
import { getRequestContext } from "../context.js";

export const processesRouter = Router();

const CFG_ENABLED = "process.overduePenalty.enabled";
const CFG_HOUR = "process.overduePenalty.hour";
const CFG_MINUTE = "process.overduePenalty.minute";
const CFG_GRACE = "process.overdueGraceDays";

const REM_ENABLED = "process.installmentReminder.enabled";
const REM_HOUR = "process.installmentReminder.hour";
const REM_MINUTE = "process.installmentReminder.minute";
const REM_DAYS = "process.installmentReminder.daysBeforeDueCsv";

processesRouter.get("/processes/config", async (_req, res, next) => {
  try {
    const companyId = getRequestContext()?.companyId;
    if (!companyId) {
      res.status(400).json({ error: "Missing tenant. Please login again." });
      return;
    }
    const rows = await prisma.systemConfig.findMany({
      where: { companyId, key: { in: [CFG_ENABLED, CFG_HOUR, CFG_MINUTE, CFG_GRACE, REM_ENABLED, REM_HOUR, REM_MINUTE, REM_DAYS] } }
    });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    res.json(
      serialize({
        overduePenalty: {
          enabled: map[CFG_ENABLED] === "true",
          hour: Number(map[CFG_HOUR] ?? "2"),
          minute: Number(map[CFG_MINUTE] ?? "0"),
          graceDays: Number(map[CFG_GRACE] ?? "0")
        },
        installmentReminders: {
          enabled: map[REM_ENABLED] === "true",
          hour: Number(map[REM_HOUR] ?? "9"),
          minute: Number(map[REM_MINUTE] ?? "0"),
          daysBeforeDueCsv: String(map[REM_DAYS] ?? "0")
        }
      })
    );
  } catch (e) {
    next(e);
  }
});

const putBody = z.object({
  overduePenalty: z.object({
    enabled: z.boolean(),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    graceDays: z.number().int().min(0).max(365).optional().default(0)
  }),
  installmentReminders: z.object({
    enabled: z.boolean(),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    daysBeforeDueCsv: z.string().min(1)
  })
});

processesRouter.put("/processes/config", async (req, res, next) => {
  try {
    const companyId = getRequestContext()?.companyId;
    if (!companyId) {
      res.status(400).json({ error: "Missing tenant. Please login again." });
      return;
    }
    const body = putBody.parse(req.body);
    await prisma.$transaction(async (tx) => {
      const upsertCfg = (key: string, value: string) =>
        tx.systemConfig.upsert({
          where: { companyId_key: { companyId, key } },
          create: { companyId, key, value },
          update: { value }
        });
      await upsertCfg(CFG_ENABLED, body.overduePenalty.enabled ? "true" : "false");
      await upsertCfg(CFG_HOUR, String(body.overduePenalty.hour));
      await upsertCfg(CFG_MINUTE, String(body.overduePenalty.minute));
      await upsertCfg(CFG_GRACE, String(body.overduePenalty.graceDays ?? 0));

      await upsertCfg(REM_ENABLED, body.installmentReminders.enabled ? "true" : "false");
      await upsertCfg(REM_HOUR, String(body.installmentReminders.hour));
      await upsertCfg(REM_MINUTE, String(body.installmentReminders.minute));
      await upsertCfg(REM_DAYS, body.installmentReminders.daysBeforeDueCsv);
    });
    const rows = await prisma.systemConfig.findMany({
      where: { companyId, key: { in: [CFG_ENABLED, CFG_HOUR, CFG_MINUTE, CFG_GRACE, REM_ENABLED, REM_HOUR, REM_MINUTE, REM_DAYS] } }
    });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    res.json(
      serialize({
        overduePenalty: {
          enabled: map[CFG_ENABLED] === "true",
          hour: Number(map[CFG_HOUR] ?? "2"),
          minute: Number(map[CFG_MINUTE] ?? "0"),
          graceDays: Number(map[CFG_GRACE] ?? "0")
        },
        installmentReminders: {
          enabled: map[REM_ENABLED] === "true",
          hour: Number(map[REM_HOUR] ?? "9"),
          minute: Number(map[REM_MINUTE] ?? "0"),
          daysBeforeDueCsv: String(map[REM_DAYS] ?? "0")
        }
      })
    );
  } catch (e) {
    next(e);
  }
});

processesRouter.get("/processes/runs", async (req, res, next) => {
  try {
    const take = Math.min(100, Number(req.query.limit) || 50);
    const companyId = getRequestContext()?.companyId;
    if (!companyId) {
      res.status(400).json({ error: "Missing tenant. Please login again." });
      return;
    }
    const jobType = String(req.query.jobType ?? "OVERDUE_LATE_FEE");
    const rows = await prisma.processRun.findMany({
      where: { companyId, jobType },
      orderBy: { startedAt: "desc" },
      take
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

processesRouter.post("/processes/overdue-late-fee/run", async (_req, res, next) => {
  try {
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId ?? null;
    if (!companyId) {
      res.status(400).json({ error: "Missing tenant. Please login again." });
      return;
    }
    const summary = await runOverdueLateFeeJob("MANUAL", companyId, branchId);
    res.json(serialize({ ok: true, summary }));
  } catch (e) {
    next(e);
  }
});

processesRouter.post("/processes/installment-reminders/whatsapp/run", async (_req, res, next) => {
  try {
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId ?? null;
    if (!companyId) {
      res.status(400).json({ error: "Missing tenant. Please login again." });
      return;
    }
    const summary = await runInstallmentWhatsAppReminderJob("MANUAL", companyId, branchId);
    res.json(serialize({ ok: true, summary }));
  } catch (e) {
    next(e);
  }
});
