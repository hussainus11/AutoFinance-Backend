import { decryptSecret } from "./crypto-secret.js";
import { prisma } from "../prisma.js";

export type MetaWhatsAppBranchConfig = {
  accessToken: string;
  phoneNumberId: string;
  templateName: string;
  language: string;
};

const KEY_ACCESS_TOKEN = "whatsapp.meta.accessToken";
const KEY_PHONE_ID = "whatsapp.meta.phoneNumberId";
const KEY_TEMPLATE = "whatsapp.meta.templateName";
const KEY_LANGUAGE = "whatsapp.meta.language";

export async function getMetaWhatsAppBranchConfigOrNull(params: {
  companyId: string;
  branchId: string;
}): Promise<MetaWhatsAppBranchConfig | null> {
  const rows = (await (prisma as any).branchSecretConfig.findMany({
    where: {
      company: { is: { id: params.companyId } },
      branch: { is: { id: params.branchId } },
      key: { in: [KEY_ACCESS_TOKEN, KEY_PHONE_ID, KEY_TEMPLATE, KEY_LANGUAGE] }
    }
  })) as any[];
  const map = new Map<string, string>(rows.map((r) => [String(r.key), String(r.valueEnc ?? "")]));
  const accessTokenEnc = map.get(KEY_ACCESS_TOKEN) ?? "";
  const phoneIdEnc = map.get(KEY_PHONE_ID) ?? "";
  const templateEnc = map.get(KEY_TEMPLATE) ?? "";
  const languageEnc = map.get(KEY_LANGUAGE) ?? "";
  if (!accessTokenEnc || !phoneIdEnc || !templateEnc) return null;

  return {
    accessToken: decryptSecret(accessTokenEnc),
    phoneNumberId: decryptSecret(phoneIdEnc),
    templateName: decryptSecret(templateEnc),
    language: languageEnc ? decryptSecret(languageEnc) : "en_US"
  };
}

function toE164(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  // Minimal normalization: keep leading + and digits.
  const cleaned = s.replace(/[^\d+]/g, "");
  return cleaned;
}

export async function sendWhatsAppTemplateViaMeta(params: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  templateName: string;
  language: string;
  bodyParams: string[];
}): Promise<{ messageId: string }> {
  const to = toE164(params.to);
  if (!to) throw new Error("Missing recipient WhatsApp number.");
  const url = `https://graph.facebook.com/v20.0/${params.phoneNumberId}/messages`;

  const payload: any = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: params.templateName,
      language: { code: params.language || "en_US" },
      components: [
        {
          type: "body",
          parameters: (params.bodyParams ?? []).map((t) => ({ type: "text", text: String(t ?? "") }))
        }
      ]
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const msg =
      json?.error?.message
        ? String(json.error.message)
        : `Meta WhatsApp API request failed (${res.status})`;
    throw new Error(msg);
  }

  const messageId = String(json?.messages?.[0]?.id ?? "");
  return { messageId };
}

