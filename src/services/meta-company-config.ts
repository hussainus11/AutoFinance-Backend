import { decryptSecret, encryptSecret, maskToken } from "./crypto-secret.js";
import { prisma } from "../prisma.js";

export const META_COMPANY_APP_ID = "whatsapp.meta.appId";
export const META_COMPANY_APP_SECRET = "whatsapp.meta.appSecret";
export const META_COMPANY_CONFIG_ID = "whatsapp.meta.configId";
export const META_COMPANY_OAUTH_REDIRECT = "whatsapp.meta.oauthRedirectUri";

const COMPANY_META_KEYS = [
  META_COMPANY_APP_ID,
  META_COMPANY_APP_SECRET,
  META_COMPANY_CONFIG_ID,
  META_COMPANY_OAUTH_REDIRECT
] as const;

export type MetaCompanyAppConfig = {
  appId: string;
  appSecret: string;
  configId: string;
  oauthRedirectUri: string;
};

export type MetaCompanyAppPublic = {
  configured: boolean;
  appId: string;
  appSecretMasked: string;
  configId: string;
  oauthRedirectUri: string;
};

export async function getCompanyMetaSecretsMap(companyId: string): Promise<Map<string, string>> {
  const rows = (await (prisma as any).companySecretConfig.findMany({
    where: {
      company: { is: { id: companyId } },
      key: { in: [...COMPANY_META_KEYS] }
    }
  })) as Array<{ key: string; valueEnc: string }>;
  return new Map(rows.map((r) => [String(r.key), String(r.valueEnc ?? "")]));
}

export async function getMetaCompanyAppPublic(companyId: string): Promise<MetaCompanyAppPublic> {
  const map = await getCompanyMetaSecretsMap(companyId);
  const appIdEnc = map.get(META_COMPANY_APP_ID) ?? "";
  const secretEnc = map.get(META_COMPANY_APP_SECRET) ?? "";
  const configEnc = map.get(META_COMPANY_CONFIG_ID) ?? "";
  const redirectEnc = map.get(META_COMPANY_OAUTH_REDIRECT) ?? "";

  const appId = appIdEnc ? decryptSecret(appIdEnc) : "";
  const configId = configEnc ? decryptSecret(configEnc) : "";
  const oauthRedirectUri = redirectEnc ? decryptSecret(redirectEnc) : "";

  return {
    configured: Boolean(appId && secretEnc && configId),
    appId,
    appSecretMasked: secretEnc ? maskToken(decryptSecret(secretEnc)) : "",
    configId,
    oauthRedirectUri
  };
}

export async function getMetaCompanyAppConfigOrThrow(companyId: string): Promise<MetaCompanyAppConfig> {
  const map = await getCompanyMetaSecretsMap(companyId);
  const appIdEnc = map.get(META_COMPANY_APP_ID) ?? "";
  const secretEnc = map.get(META_COMPANY_APP_SECRET) ?? "";
  const configEnc = map.get(META_COMPANY_CONFIG_ID) ?? "";
  const redirectEnc = map.get(META_COMPANY_OAUTH_REDIRECT) ?? "";

  if (!appIdEnc || !secretEnc || !configEnc) {
    throw new Error(
      "Save your Meta App ID, App Secret, and Configuration ID in Settings first, then use Connect with Meta."
    );
  }

  const oauthRedirectUri = redirectEnc
    ? decryptSecret(redirectEnc)
    : (process.env.META_OAUTH_REDIRECT_URI ?? "https://localhost:3000/").trim();

  return {
    appId: decryptSecret(appIdEnc),
    appSecret: decryptSecret(secretEnc),
    configId: decryptSecret(configEnc),
    oauthRedirectUri
  };
}

/** Copy valid platform .env Meta app into this company (one-time) so users need not paste credentials. */
export async function ensureCompanyMetaFromPlatformEnv(companyId: string): Promise<boolean> {
  const appId = (process.env.META_APP_ID ?? "").trim();
  const appSecret = (process.env.META_APP_SECRET ?? "").trim();
  const configId = (process.env.META_WHATSAPP_CONFIG_ID ?? "").trim();
  if (!appId || !appSecret || !configId) return false;
  if (appId.includes("your_") || appSecret.includes("your_") || configId.includes("your_")) return false;

  const existing = await getCompanyMetaSecretsMap(companyId);
  if (existing.get(META_COMPANY_APP_SECRET)) return true;

  await upsertCompanyMetaAppConfig(companyId, {
    appId,
    appSecret,
    configId,
    oauthRedirectUri: (process.env.META_OAUTH_REDIRECT_URI ?? "https://localhost:3000/").trim()
  });
  return true;
}

export async function upsertCompanyMetaAppConfig(
  companyId: string,
  input: {
    appId: string;
    appSecret?: string;
    configId: string;
    oauthRedirectUri?: string;
  }
): Promise<void> {
  const existing = await getCompanyMetaSecretsMap(companyId);
  const secretPlain = (input.appSecret ?? "").trim();
  if (!secretPlain && !existing.get(META_COMPANY_APP_SECRET)) {
    throw new Error("App Secret is required");
  }

  await prisma.$transaction(async (tx) => {
    const upsert = async (key: string, plain: string) => {
      const valueEnc = encryptSecret(plain.trim());
      await (tx as any).companySecretConfig.upsert({
        where: { companyId_key: { companyId, key } },
        create: { companyId, key, valueEnc },
        update: { valueEnc }
      });
    };
    await upsert(META_COMPANY_APP_ID, input.appId);
    if (secretPlain) await upsert(META_COMPANY_APP_SECRET, secretPlain);
    await upsert(META_COMPANY_CONFIG_ID, input.configId);
    if (input.oauthRedirectUri?.trim()) {
      await upsert(META_COMPANY_OAUTH_REDIRECT, input.oauthRedirectUri.trim());
    }
  });
}
