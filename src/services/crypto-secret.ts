import crypto from "node:crypto";

function getKey(): Buffer {
  const raw = (process.env.AF_SECRET_KEY ?? "").trim();
  if (!raw) {
    throw new Error("Missing AF_SECRET_KEY (required to encrypt WhatsApp access tokens).");
  }
  // Accept base64 or hex; fall back to utf8.
  let buf: Buffer | null = null;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    buf = null;
  }
  if (buf && buf.length === 32) return buf;
  try {
    buf = Buffer.from(raw, "hex");
  } catch {
    buf = null;
  }
  if (buf && buf.length === 32) return buf;
  const utf8 = Buffer.from(raw, "utf8");
  if (utf8.length === 32) return utf8;
  throw new Error("AF_SECRET_KEY must be 32 bytes (base64/hex/utf8).");
}

export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.from(
    JSON.stringify({
      v: 1,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ct: ciphertext.toString("base64")
    }),
    "utf8"
  ).toString("base64");
}

export function decryptSecret(enc: string): string {
  const key = getKey();
  const raw = Buffer.from(enc, "base64").toString("utf8");
  const parsed = JSON.parse(raw) as { v: number; iv: string; tag: string; ct: string };
  if (!parsed?.iv || !parsed?.tag || !parsed?.ct) throw new Error("Invalid encrypted secret payload.");
  const iv = Buffer.from(parsed.iv, "base64");
  const tag = Buffer.from(parsed.tag, "base64");
  const ct = Buffer.from(parsed.ct, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString("utf8");
}

export function maskToken(token: string | null | undefined): string {
  const t = (token ?? "").trim();
  if (!t) return "";
  if (t.length <= 10) return `${t.slice(0, 2)}…${t.slice(-2)}`;
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

