const DEFAULT_GRAPH_VERSION = (process.env.META_GRAPH_VERSION ?? "v25.0").trim();

export async function exchangeEmbeddedSignupCode(params: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
  graphVersion?: string;
}): Promise<string> {
  const graphVersion = params.graphVersion ?? DEFAULT_GRAPH_VERSION;
  const tokenRes = await fetch(
    `https://graph.facebook.com/${graphVersion}/oauth/access_token?` +
      new URLSearchParams({
        client_id: params.appId,
        client_secret: params.appSecret,
        redirect_uri: params.redirectUri,
        code: params.code
      }).toString(),
    { method: "GET" }
  );
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    error?: { message?: string };
  };
  if (!tokenRes.ok) {
    const msg = tokenJson?.error?.message
      ? String(tokenJson.error.message)
      : `Token exchange failed (${tokenRes.status})`;
    throw new Error(msg);
  }
  const accessToken = String(tokenJson.access_token ?? "");
  if (!accessToken) throw new Error("Missing access_token in token exchange response");
  return accessToken;
}

export async function fetchWhatsAppPhoneDetails(params: {
  accessToken: string;
  phoneNumberId: string;
  graphVersion?: string;
}): Promise<{ displayPhoneNumber: string; verifiedName: string }> {
  const graphVersion = params.graphVersion ?? DEFAULT_GRAPH_VERSION;
  const url =
    `https://graph.facebook.com/${graphVersion}/${params.phoneNumberId}?` +
    new URLSearchParams({ fields: "display_phone_number,verified_name" });
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${params.accessToken}` }
  });
  const json = (await res.json().catch(() => ({}))) as {
    display_phone_number?: string;
    verified_name?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    const msg = json?.error?.message ? String(json.error.message) : `Phone lookup failed (${res.status})`;
    throw new Error(msg);
  }
  return {
    displayPhoneNumber: String(json.display_phone_number ?? "").trim(),
    verifiedName: String(json.verified_name ?? "").trim()
  };
}

export type MetaMessageTemplate = {
  name: string;
  language: string;
  status: string;
};

export async function fetchWhatsAppMessageTemplates(params: {
  accessToken: string;
  wabaId: string;
  graphVersion?: string;
}): Promise<MetaMessageTemplate[]> {
  const graphVersion = params.graphVersion ?? DEFAULT_GRAPH_VERSION;
  const url =
    `https://graph.facebook.com/${graphVersion}/${params.wabaId}/message_templates?` +
    new URLSearchParams({ fields: "name,language,status", limit: "50" });
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${params.accessToken}` }
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: Array<{ name?: string; language?: string; status?: string }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    const msg = json?.error?.message ? String(json.error.message) : `Template lookup failed (${res.status})`;
    throw new Error(msg);
  }
  return (json.data ?? []).map((t) => ({
    name: String(t.name ?? "").trim(),
    language: String(t.language ?? "").trim(),
    status: String(t.status ?? "").trim()
  }));
}

export function pickDefaultTemplate(templates: MetaMessageTemplate[]): MetaMessageTemplate | null {
  const approved = templates.filter((t) => t.name && t.status.toUpperCase() === "APPROVED");
  return approved[0] ?? templates.find((t) => t.name) ?? null;
}
