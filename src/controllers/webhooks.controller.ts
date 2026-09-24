import { Router, type Request } from "express";
import crypto from "node:crypto";

export const webhooksRouter = Router();

function getRawBody(req: Request): Buffer {
  const b = (req as any).rawBody;
  if (Buffer.isBuffer(b)) return b;
  // Fallback: best-effort serialize parsed body.
  try {
    return Buffer.from(JSON.stringify(req.body ?? {}), "utf8");
  } catch {
    return Buffer.from("", "utf8");
  }
}

function verifyMetaSignature(req: Request): void {
  const secret = (process.env.META_APP_SECRET ?? "").trim();
  const sig = (req.header("x-hub-signature-256") ?? "").trim();
  if (!secret) return; // optional
  if (!sig) return; // optional

  const raw = getRawBody(req);
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
  // timing safe compare
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Invalid Meta signature");
  }
}

/**
 * Meta webhook verification endpoint (GET).
 * Configure:
 * - Callback URL: https://<public>/api/webhooks/meta/whatsapp
 * - Verify token: META_WHATSAPP_VERIFY_TOKEN (env)
 */
webhooksRouter.get("/webhooks/meta/whatsapp", (req, res) => {
  const mode = String(req.query["hub.mode"] ?? "");
  const token = String(req.query["hub.verify_token"] ?? "");
  const challenge = String(req.query["hub.challenge"] ?? "");

  if (mode !== "subscribe") {
    res.status(400).send("Invalid mode");
    return;
  }
  const expected = (process.env.META_WHATSAPP_VERIFY_TOKEN ?? "").trim();
  if (!expected) {
    res.status(500).send("Server missing META_WHATSAPP_VERIFY_TOKEN");
    return;
  }
  if (token !== expected) {
    res.status(403).send("Forbidden");
    return;
  }
  res.status(200).send(challenge);
});

/**
 * Meta WhatsApp webhook receiver (POST).
 * Note: we currently just ACK and log; you can extend to store delivery statuses.
 */
webhooksRouter.post("/webhooks/meta/whatsapp", (req, res) => {
  try {
    verifyMetaSignature(req);
    // Always ACK quickly to avoid retries; do async processing if needed.
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "Forbidden" });
  } finally {
    try {
      // Keep logs small; Meta payloads can be large.
      const body = req.body as any;
      const entry = body?.entry?.[0];
      const changes = entry?.changes?.[0]?.value;
      if (changes) {
        console.log("[meta-webhook] event", JSON.stringify({ object: body?.object, changesKeys: Object.keys(changes) }));
      } else {
        console.log("[meta-webhook] event", JSON.stringify({ object: body?.object }));
      }
    } catch {
      // ignore
    }
  }
});

