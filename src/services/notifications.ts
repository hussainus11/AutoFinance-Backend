import { prisma } from "../prisma.js";
import { emitToTaskQueue, emitToUser, type RealtimeNotificationPayload } from "../realtime.js";
import { serialize } from "../serialize.js";
import { getRequestContext } from "../context.js";

export async function getTaskQueueEligibleUserIds(): Promise<string[]> {
  const users = await prisma.user.findMany({ select: { id: true, role: true } });
  if (!users.length) return [];

  const adminIds = users.filter((u) => (u.role ?? "").toUpperCase() === "ADMIN").map((u) => u.id);

  const roleNames = Array.from(
    new Set(
      users
        .map((u) => (u.role ?? "").trim())
        .filter((r) => r.length > 0 && r.toUpperCase() !== "ADMIN")
    )
  );
  if (!roleNames.length) return adminIds;

  const perms = await prisma.rolePermission.findMany({
    where: { key: "/dashboard/autofinance/task-queue", role: { name: { in: roleNames } } },
    select: { role: { select: { name: true } } }
  });
  const allowedRoles = new Set(perms.map((p) => p.role.name));

  const eligible = users
    .filter((u) => (u.role ?? "").toUpperCase() === "ADMIN" || allowedRoles.has((u.role ?? "").trim()))
    .map((u) => u.id);

  return eligible;
}

export async function notifyUsers({
  userIds,
  type,
  title,
  message,
  href
}: {
  userIds: string[];
  type: string;
  title: string;
  message?: string | null;
  href?: string | null;
}) {
  const companyId = getRequestContext()?.companyId ?? "";
  if (!companyId) throw new Error("Missing tenant");
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  const created: any[] = [];

  for (const userId of unique) {
    const row = await prisma.notification.create({
      data: {
        user: { connect: { id: userId } },
        type,
        title,
        message: message ?? undefined,
        href: href ?? undefined,
        isRead: false
      }
    });
    created.push(row);

    const payload: RealtimeNotificationPayload = {
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message ?? null,
      href: row.href ?? null,
      isRead: row.isRead,
      createdAt: row.createdAt.toISOString()
    };
    emitToUser(companyId, userId, payload);
  }

  return serialize(created);
}

export async function notifyTaskQueueUsers({
  type,
  title,
  message,
  href
}: {
  type: string;
  title: string;
  message?: string | null;
  href?: string | null;
}) {
  const companyId = getRequestContext()?.companyId ?? "";
  if (!companyId) throw new Error("Missing tenant");
  const ids = await getTaskQueueEligibleUserIds();
  const rows = await notifyUsers({ userIds: ids, type, title, message, href });

  // Also emit to taskqueue room for clients that joined it.
  // (User-specific emits already happen above.)
  const payload: RealtimeNotificationPayload = {
    id: `broadcast-${Date.now()}`,
    type,
    title,
    message: message ?? null,
    href: href ?? null,
    isRead: false,
    createdAt: new Date().toISOString()
  };
  emitToTaskQueue(companyId, payload);

  return rows;
}

export async function getAdminUserIds(): Promise<string[]> {
  const users = await prisma.user.findMany({ select: { id: true, role: true } });
  return users.filter((u) => (u.role ?? "").toUpperCase() === "ADMIN").map((u) => u.id);
}

export async function notifyAdminUsers({
  type,
  title,
  message,
  href
}: {
  type: string;
  title: string;
  message?: string | null;
  href?: string | null;
}) {
  const ids = await getAdminUserIds();
  return notifyUsers({ userIds: ids, type, title, message, href });
}

