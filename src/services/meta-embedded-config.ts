import {
  getMetaCompanyAppConfigOrThrow,
  type MetaCompanyAppConfig
} from "./meta-company-config.js";

export type MetaEmbeddedSource = "platform" | "company";

export type ResolvedMetaEmbeddedApp = MetaCompanyAppConfig & {
  source: MetaEmbeddedSource;
};

function platformMetaFromEnv(): ResolvedMetaEmbeddedApp | null {
  const appId = (process.env.META_APP_ID ?? "").trim();
  const appSecret = (process.env.META_APP_SECRET ?? "").trim();
  const configId = (process.env.META_WHATSAPP_CONFIG_ID ?? "").trim();
  if (!appId || !appSecret || !configId) return null;
  if (appId.includes("your_") || appSecret.includes("your_") || configId.includes("your_")) {
    return null;
  }
  return {
    source: "platform",
    appId,
    appSecret,
    configId,
    oauthRedirectUri: (process.env.META_OAUTH_REDIRECT_URI ?? "https://localhost:3000/").trim()
  };
}

/** Per-company DB first (user setup in app), then platform .env fallback. */
export async function resolveMetaEmbeddedApp(companyId: string): Promise<ResolvedMetaEmbeddedApp> {
  try {
    const company = await getMetaCompanyAppConfigOrThrow(companyId);
    return { ...company, source: "company" };
  } catch {
    const platform = platformMetaFromEnv();
    if (platform) return platform;
    throw new Error(
      "WhatsApp is not set up for this company yet. Use Connect with Meta or save your connection details below."
    );
  }
}

export async function tryResolveMetaEmbeddedApp(
  companyId: string
): Promise<ResolvedMetaEmbeddedApp | null> {
  try {
    return await getMetaCompanyAppConfigOrThrow(companyId).then((c) => ({
      ...c,
      source: "company" as const
    }));
  } catch {
    return platformMetaFromEnv();
  }
}
