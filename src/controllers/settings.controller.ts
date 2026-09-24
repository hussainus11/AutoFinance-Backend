import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { decryptSecret, encryptSecret, maskToken } from "../services/crypto-secret.js";
import { getRequestContext } from "../context.js";
import {
  ensureCompanyMetaFromPlatformEnv,
  getMetaCompanyAppPublic,
  upsertCompanyMetaAppConfig
} from "../services/meta-company-config.js";
import { resolveMetaEmbeddedApp, tryResolveMetaEmbeddedApp } from "../services/meta-embedded-config.js";
import {
  exchangeEmbeddedSignupCode,
  fetchWhatsAppMessageTemplates,
  fetchWhatsAppPhoneDetails,
  pickDefaultTemplate
} from "../services/meta-graph.js";
import { sendWhatsAppTemplateViaMeta } from "../services/meta-whatsapp.js";

export const settingsRouter = Router();

async function ensureSettingsTenancyColumns(): Promise<boolean> {
  try {
    const rows = (await (prisma as any).$queryRawUnsafe(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'SystemConfig'
        AND column_name = 'companyId'
      LIMIT 1
      `
    )) as Array<{ column_name: string }>;
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

/** Settings page — system config + audit log listing. */
settingsRouter.get("/settings/config", async (_req, res, next) => {
  try {
    const companyId = getRequestContext()?.companyId;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });
    const ok = await ensureSettingsTenancyColumns();
    if (!ok) {
      res.status(500).json({
        error:
          'Database is missing multi-tenant columns for "SystemConfig". Stop the API and run `npm run db:deploy`, then restart.'
      });
      return;
    }
    const rows = await (prisma as any).$queryRawUnsafe(
      `SELECT "key", "value", "updatedAt" FROM "SystemConfig" WHERE "companyId" = $1 ORDER BY "key" ASC`,
      companyId
    );
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

settingsRouter.put("/settings/config/:key", async (req, res, next) => {
  try {
    const body = z.object({ value: z.string() }).parse(req.body);
    const companyId = getRequestContext()?.companyId;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });
    const ok = await ensureSettingsTenancyColumns();
    if (!ok) {
      res.status(500).json({
        error:
          'Database is missing multi-tenant columns for "SystemConfig". Stop the API and run `npm run db:deploy`, then restart.'
      });
      return;
    }
    const row = await (prisma as any).$queryRawUnsafe(
      `
      INSERT INTO "SystemConfig" ("companyId", "key", "value", "updatedAt")
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT ("companyId", "key") DO UPDATE SET
        "value" = EXCLUDED."value",
        "updatedAt" = NOW()
      RETURNING "key", "value", "updatedAt"
      `,
      companyId,
      req.params.key,
      body.value
    );
    res.json(serialize(Array.isArray(row) ? row[0] : row));
  } catch (e) {
    next(e);
  }
});

const META_ACCESS = "whatsapp.meta.accessToken";
const META_PHONE_ID = "whatsapp.meta.phoneNumberId";
const META_TEMPLATE = "whatsapp.meta.templateName";
const META_LANGUAGE = "whatsapp.meta.language";
const META_WABA_ID = "whatsapp.meta.wabaId";

settingsRouter.get("/settings/whatsapp/meta/app", async (_req, res, next) => {
  try {
    const companyId = getRequestContext()?.companyId;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });
    res.json(serialize(await getMetaCompanyAppPublic(companyId)));
  } catch (e) {
    next(e);
  }
});

settingsRouter.put("/settings/whatsapp/meta/app", async (req, res, next) => {
  try {
    const companyId = getRequestContext()?.companyId;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });

    const body = z
      .object({
        appId: z.string().min(3),
        appSecret: z.string().optional(),
        configId: z.string().min(3),
        oauthRedirectUri: z.string().url().optional()
      })
      .parse(req.body);

    await upsertCompanyMetaAppConfig(companyId, {
      appId: body.appId,
      configId: body.configId,
      appSecret: body.appSecret,
      oauthRedirectUri: body.oauthRedirectUri
    });
    res.json(serialize(await getMetaCompanyAppPublic(companyId)));
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    next(e);
  }
});

settingsRouter.get("/settings/whatsapp/meta", async (_req, res, next) => {
  try {
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId;
    if (!companyId || !branchId) return res.status(400).json({ error: "Missing tenant" });

    const rows = (await (prisma as any).branchSecretConfig.findMany({
      where: {
        company: { is: { id: companyId } },
        branch: { is: { id: branchId } },
        key: { in: [META_ACCESS, META_PHONE_ID, META_TEMPLATE, META_LANGUAGE, META_WABA_ID] }
      }
    })) as any[];
    const map = new Map<string, string>(rows.map((r) => [String(r.key), String(r.valueEnc ?? "")]));
    const accessEnc = map.get(META_ACCESS) ?? "";
    const phoneEnc = map.get(META_PHONE_ID) ?? "";
    const templateEnc = map.get(META_TEMPLATE) ?? "";
    const langEnc = map.get(META_LANGUAGE) ?? "";
    const wabaEnc = map.get(META_WABA_ID) ?? "";

    res.json(
      serialize({
        configured: Boolean(accessEnc && phoneEnc && templateEnc),
        connected: Boolean(accessEnc && phoneEnc),
        accessTokenMasked: accessEnc ? maskToken(decryptSecret(accessEnc)) : "",
        phoneNumberId: phoneEnc ? decryptSecret(phoneEnc) : "",
        wabaId: wabaEnc ? decryptSecret(wabaEnc) : "",
        templateName: templateEnc ? decryptSecret(templateEnc) : "",
        language: langEnc ? decryptSecret(langEnc) : "en_US"
      })
    );
  } catch (e) {
    next(e);
  }
});

// Embedded Signup config for the frontend (platform env or company DB — not shown to users).
settingsRouter.get("/settings/whatsapp/meta/embedded/config", async (_req, res, next) => {
  try {
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId;
    if (!companyId || !branchId) return res.status(400).json({ error: "Missing tenant" });

    await ensureCompanyMetaFromPlatformEnv(companyId);
    const companyApp = await getMetaCompanyAppPublic(companyId);
    const app = await tryResolveMetaEmbeddedApp(companyId);
    const graphVersion = (process.env.META_GRAPH_VERSION ?? "v25.0").trim();
    if (!app) {
      res.json(
        serialize({
          ready: false,
          needsCompanyApp: !companyApp.configured,
          companyAppConfigured: companyApp.configured,
          graphVersion
        })
      );
      return;
    }
    res.json(
      serialize({
        ready: true,
        companyAppConfigured: companyApp.configured,
        appId: app.appId,
        configId: app.configId,
        oauthRedirectUri: app.oauthRedirectUri,
        graphVersion
      })
    );
  } catch (e) {
    next(e);
  }
});

// Exchange Embedded Signup code for access token and store assets for this branch.
settingsRouter.post("/settings/whatsapp/meta/embedded/exchange", async (req, res, next) => {
  try {
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId;
    if (!companyId || !branchId) return res.status(400).json({ error: "Missing tenant" });

    const body = z
      .object({
        code: z.string().min(3),
        phoneNumberId: z.string().min(3),
        wabaId: z.string().min(3),
        redirectUri: z.string().url().optional()
      })
      .strict()
      .parse(req.body);

    const app = await resolveMetaEmbeddedApp(companyId);
    const redirectUri = body.redirectUri?.trim() || app.oauthRedirectUri;
    const graphVersion = (process.env.META_GRAPH_VERSION ?? "v25.0").trim();

    const accessToken = await exchangeEmbeddedSignupCode({
      appId: app.appId,
      appSecret: app.appSecret,
      redirectUri,
      code: body.code,
      graphVersion
    });

    let displayPhoneNumber = "";
    let verifiedName = "";
    try {
      const phone = await fetchWhatsAppPhoneDetails({
        accessToken,
        phoneNumberId: body.phoneNumberId,
        graphVersion
      });
      displayPhoneNumber = phone.displayPhoneNumber;
      verifiedName = phone.verifiedName;
    } catch {
      // non-fatal — branch still connected with IDs from Embedded Signup
    }

    let templateName = "";
    let language = "en_US";
    const templates = await fetchWhatsAppMessageTemplates({
      accessToken,
      wabaId: body.wabaId,
      graphVersion
    }).catch(() => [] as Awaited<ReturnType<typeof fetchWhatsAppMessageTemplates>>);
    const picked = pickDefaultTemplate(templates);
    if (picked) {
      templateName = picked.name;
      language = picked.language || "en_US";
    }

    await prisma.$transaction(async (tx) => {
      const upsertEnc = async (key: string, plain: string) => {
        const valueEnc = encryptSecret(plain.trim());
        await (tx as any).branchSecretConfig.upsert({
          where: { companyId_branchId_key: { companyId, branchId, key } },
          create: { companyId, branchId, key, valueEnc },
          update: { valueEnc }
        });
      };
      await upsertEnc(META_ACCESS, accessToken);
      await upsertEnc(META_PHONE_ID, body.phoneNumberId);
      await upsertEnc(META_WABA_ID, body.wabaId);
      if (templateName) {
        await upsertEnc(META_TEMPLATE, templateName);
        await upsertEnc(META_LANGUAGE, language);
      }
      if (displayPhoneNumber) {
        await (tx as any).branch.update({
          where: { id: branchId },
          data: { whatsappNumber: displayPhoneNumber }
        });
      }
    });

    res.json(
      serialize({
        ok: true,
        phoneNumberId: body.phoneNumberId,
        wabaId: body.wabaId,
        displayPhoneNumber,
        verifiedName,
        templateName: templateName || null,
        language,
        templates: templates.slice(0, 20)
      })
    );
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: e.flatten() });
      return;
    }
    next(e);
  }
});

settingsRouter.delete("/settings/whatsapp/meta/embedded", async (_req, res, next) => {
  try {
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId;
    if (!companyId || !branchId) return res.status(400).json({ error: "Missing tenant" });

    await (prisma as any).branchSecretConfig.deleteMany({
      where: {
        company: { is: { id: companyId } },
        branch: { is: { id: branchId } },
        key: { in: [META_ACCESS, META_PHONE_ID, META_WABA_ID] }
      }
    });

    res.json(serialize({ ok: true }));
  } catch (e) {
    next(e);
  }
});

settingsRouter.put("/settings/whatsapp/meta", async (req, res, next) => {
  try {
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId;
    if (!companyId || !branchId) return res.status(400).json({ error: "Missing tenant" });

    const body = z
      .object({
        accessToken: z.string().optional(),
        phoneNumberId: z.string().min(3),
        templateName: z.string().min(1),
        language: z.string().min(2).default("en_US")
      })
      .parse(req.body);

    const existingRows = (await (prisma as any).branchSecretConfig.findMany({
      where: {
        company: { is: { id: companyId } },
        branch: { is: { id: branchId } },
        key: META_ACCESS
      }
    })) as any[];
    const existingAccessEnc = String(existingRows[0]?.valueEnc ?? "");
    const accessPlain = (body.accessToken ?? "").trim();
    if (!accessPlain && !existingAccessEnc) {
      return res.status(400).json({ error: "Connect with Meta first to obtain an access token for this branch." });
    }

    await prisma.$transaction(async (tx) => {
      const upsert = async (key: string, plain: string) => {
        const valueEnc = encryptSecret(plain.trim());
        await (tx as any).branchSecretConfig.upsert({
          where: { companyId_branchId_key: { companyId, branchId, key } },
          create: { companyId, branchId, key, valueEnc },
          update: { valueEnc }
        });
      };
      if (accessPlain) await upsert(META_ACCESS, accessPlain);
      await upsert(META_PHONE_ID, body.phoneNumberId);
      await upsert(META_TEMPLATE, body.templateName);
      await upsert(META_LANGUAGE, body.language);
    });

    res.json(serialize({ ok: true }));
  } catch (e) {
    next(e);
  }
});

settingsRouter.post("/settings/whatsapp/meta/test", async (req, res, next) => {
  try {
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId;
    if (!companyId || !branchId) return res.status(400).json({ error: "Missing tenant" });

    const body = z
      .object({
        to: z.string().min(8),
        params: z.array(z.string()).optional()
      })
      .parse(req.body);

    const rows = (await (prisma as any).branchSecretConfig.findMany({
      where: {
        company: { is: { id: companyId } },
        branch: { is: { id: branchId } },
        key: { in: [META_ACCESS, META_PHONE_ID, META_TEMPLATE, META_LANGUAGE] }
      }
    })) as any[];
    const map = new Map<string, string>(rows.map((r) => [String(r.key), String(r.valueEnc ?? "")]));
    const accessEnc = map.get(META_ACCESS) ?? "";
    const phoneEnc = map.get(META_PHONE_ID) ?? "";
    const templateEnc = map.get(META_TEMPLATE) ?? "";
    if (!accessEnc || !phoneEnc || !templateEnc) {
      return res.status(400).json({ error: "WhatsApp Meta settings are not configured for this branch." });
    }

    const accessToken = decryptSecret(accessEnc);
    const phoneNumberId = decryptSecret(phoneEnc);
    const templateName = decryptSecret(templateEnc);
    const langEnc = map.get(META_LANGUAGE) ?? "";
    const language = langEnc ? decryptSecret(langEnc) : "en_US";

    const out = await sendWhatsAppTemplateViaMeta({
      accessToken,
      phoneNumberId,
      to: body.to,
      templateName,
      language,
      bodyParams: body.params ?? ["1", "2026-01-01", "CT-0001", "1000"]
    });

    res.json(serialize({ ok: true, messageId: out.messageId }));
  } catch (e) {
    next(e);
  }
});

settingsRouter.get("/audit-logs", async (req, res, next) => {
  try {
    const take = Math.min(200, Number(req.query.limit) || 50);
    const companyId = getRequestContext()?.companyId;
    if (!companyId) return res.status(400).json({ error: "Missing tenant" });
    const ok = await ensureSettingsTenancyColumns();
    if (!ok) {
      res.status(500).json({
        error:
          'Database is missing multi-tenant columns for "AuditLog/SystemConfig". Stop the API and run `npm run db:deploy`, then restart.'
      });
      return;
    }
    const scope = typeof req.query.scope === "string" ? req.query.scope.trim().toLowerCase() : "";
    const currentUserId = (getRequestContext()?.userId ?? "").trim();

    let rows: unknown;
    if (scope === "me") {
      if (!currentUserId) {
        res.json(serialize([]));
        return;
      }
      rows = await (prisma as any).$queryRawUnsafe(
        `
        SELECT "id", "action", "entityType", "entityId", "createdAt"
        FROM "AuditLog"
        WHERE COALESCE("companyId", $1) = $1
          AND "userId" = $2
        ORDER BY "createdAt" DESC
        LIMIT $3
        `,
        companyId,
        currentUserId,
        take
      );
    } else {
      rows = await (prisma as any).$queryRawUnsafe(
        `
        SELECT "id", "action", "entityType", "entityId", "createdAt"
        FROM "AuditLog"
        WHERE COALESCE("companyId", $1) = $1
        ORDER BY "createdAt" DESC
        LIMIT $2
        `,
        companyId,
        take
      );
    }
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});
