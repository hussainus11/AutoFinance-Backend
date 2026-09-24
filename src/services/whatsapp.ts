function toWhatsAppAddress(e164OrWhatsApp: string): string {
  const raw = (e164OrWhatsApp ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("whatsapp:")) return raw;
  return `whatsapp:${raw}`;
}

export async function sendWhatsAppViaTwilio({
  to,
  from,
  body
}: {
  to: string;
  from: string;
  body: string;
}): Promise<{ sid: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  if (!accountSid || !authToken) {
    throw new Error("Twilio WhatsApp is not configured (missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).");
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const form = new URLSearchParams();
  form.set("To", toWhatsAppAddress(to));
  form.set("From", toWhatsAppAddress(from));
  form.set("Body", body);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });

  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const msg = json?.message ? String(json.message) : `Twilio request failed (${res.status})`;
    throw new Error(msg);
  }

  return { sid: String(json.sid ?? "") };
}

