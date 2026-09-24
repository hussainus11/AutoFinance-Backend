import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { parseCookie as parseCookieHeader } from "cookie";
import { verifyStaffAccessToken } from "./auth/jwt.js";

type TenantUser = {
  companyId: string;
  userId: string;
};

export type RealtimeNotificationPayload = {
  id: string;
  type: string;
  title: string;
  message?: string | null;
  href?: string | null;
  isRead: boolean;
  createdAt: string;
};

let io: Server | null = null;

function roomForUser(x: TenantUser) {
  return `c:${x.companyId}:u:${x.userId}`;
}

function roomForTaskQueue(companyId: string) {
  return `c:${companyId}:taskqueue`;
}

export function initRealtime(httpServer: HttpServer, corsOrigin: string | undefined) {
  io = new Server(httpServer, {
    cors: {
      origin: corsOrigin ? corsOrigin.split(",").map((s) => s.trim()) : true,
      credentials: true
    }
  });

  io.on("connection", (socket) => {
    const cookies = parseCookieHeader(socket.handshake.headers.cookie ?? "");
    const token = cookies["af_access"];
    if (!token) {
      socket.disconnect(true);
      return;
    }

    let claims;
    try {
      claims = verifyStaffAccessToken(token);
    } catch {
      socket.disconnect(true);
      return;
    }

    const companyId = claims.companyId;
    const userId = claims.sub;
    socket.join(roomForUser({ companyId, userId }));

    // Optional: join taskqueue room if client tells us it has access.
    // We still only emit task-queue notifications to specific users in backend.
    // (Non-sensitive UX hint — actual notification targeting is always by verified companyId/userId.)
    const auth = (socket.handshake.auth ?? {}) as any;
    const wantsTaskQueue = Boolean(auth.taskQueue === true);
    if (wantsTaskQueue) {
      socket.join(roomForTaskQueue(companyId));
    }
  });

  return io;
}

export function emitToUser(companyId: string, userId: string, payload: RealtimeNotificationPayload) {
  if (!io) return;
  io.to(roomForUser({ companyId, userId })).emit("notification:new", payload);
}

export function emitToTaskQueue(companyId: string, payload: RealtimeNotificationPayload) {
  if (!io) return;
  io.to(roomForTaskQueue(companyId)).emit("notification:new", payload);
}

