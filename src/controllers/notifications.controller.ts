import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { getRequestContext } from "../context.js";

export const notificationsRouter = Router();

notificationsRouter.get("/notifications", async (req, res, next) => {
  try {
    const userId = getRequestContext()?.userId ?? "";
    if (!userId) return res.status(400).json({ error: "Missing user context" });

    const unread = (typeof req.query.unread === "string" ? req.query.unread.trim() : "") === "1";
    const takeRaw = typeof req.query.take === "string" ? req.query.take.trim() : "20";
    const take = Math.max(1, Math.min(100, Number(takeRaw) || 20));

    const rows = await prisma.notification.findMany({
      where: { userId, ...(unread ? { isRead: false } : {}) },
      orderBy: { createdAt: "desc" },
      take
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

notificationsRouter.get("/notifications/unread-count", async (_req, res, next) => {
  try {
    const userId = getRequestContext()?.userId ?? "";
    if (!userId) return res.status(400).json({ error: "Missing user context" });
    const n = await prisma.notification.count({ where: { userId, isRead: false } });
    res.json({ count: n });
  } catch (e) {
    next(e);
  }
});

notificationsRouter.post("/notifications/mark-read", async (req, res, next) => {
  try {
    const userId = getRequestContext()?.userId ?? "";
    if (!userId) return res.status(400).json({ error: "Missing user context" });

    const body = z
      .object({
        ids: z.array(z.string().uuid()).min(1)
      })
      .strict()
      .parse(req.body);

    await prisma.notification.updateMany({
      where: { userId, id: { in: body.ids } },
      data: { isRead: true }
    });
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    next(e);
  }
});

notificationsRouter.post("/notifications/mark-all-read", async (_req, res, next) => {
  try {
    const userId = getRequestContext()?.userId ?? "";
    if (!userId) return res.status(400).json({ error: "Missing user context" });
    await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

