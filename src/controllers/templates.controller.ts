import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { getRequestContext } from "../context.js";

export const templatesRouter = Router();

type TemplateKey = "STAMP_PAPER_AGREEMENT" | "QUOTATION_PRINT" | "RECEIPT_PRINT";

const TEMPLATE_DEFS: Array<{ key: TemplateKey; title: string }> = [
  { key: "STAMP_PAPER_AGREEMENT", title: "Stamp paper agreement" },
  { key: "QUOTATION_PRINT", title: "Quotation print" },
  { key: "RECEIPT_PRINT", title: "Receipt print" }
];

function defaultStampPaperTemplateHtml(lang: "en" | "ur"): string {
  if (lang === "ur") {
    return `
<div style="text-align:center; margin-bottom: 12px;">
  <div style="font-size: 18px; font-weight: 700;">اسٹیمپ پیپر معاہدہ</div>
  <div style="font-size: 12px; color: #6b7280;">(یہ ایک نمونہ ٹیمپلیٹ ہے۔ براہِ کرم اپنے قانونی مشیر سے مشورہ کریں۔)</div>
</div>

<div style="font-size: 14px; line-height: 1.8;">
  <p>یہ معاہدہ <strong>{{contractDate}}</strong> کو طے پایا۔</p>
  <p><strong>فنانسر/فروخت کنندہ</strong>: {{companyName}}</p>
  <p><strong>خریدار</strong>: <strong>{{buyerName}}</strong>، شناختی کارڈ <strong>{{buyerCnic}}</strong>، پتہ: <strong>{{buyerAddress}}</strong></p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 12px 0;" />
  <p style="font-weight:700;">معاہدے کی معلومات</p>
  <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px 24px;">
    <div><span style="color:#374151;">معاہدہ نمبر:</span> <code>{{contractNumber}}</code></div>
    <div><span style="color:#374151;">گاڑی:</span> {{vehicleLine}}</div>
    <div><span style="color:#374151;">سیل پرائس:</span> {{salePrice}}</div>
    <div><span style="color:#374151;">اصل رقم (Principal):</span> {{principalAmount}}</div>
    <div><span style="color:#374151;">منافع کی شرح (Profit Rate):</span> {{profitRate}}%</div>
    <div><span style="color:#374151;">مدت:</span> {{tenureMonths}} ماہ</div>
    <div><span style="color:#374151;">اقساط کی قسم:</span> {{installmentType}}</div>
    <div><span style="color:#374151;">شیڈول آغاز:</span> {{startDate}}</div>
  </div>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 12px 0;" />
  <p style="font-weight:700;">شرائط و ضوابط</p>
  <ol style="list-style: decimal; padding-left: 18px; margin: 0; display: grid; gap: 8px;">
    <li>خریدار طے شدہ شیڈول کے مطابق اقساط ادا کرے گا۔ تاخیر کی صورت میں پالیسی/قانون کے مطابق جرمانہ ہو سکتا ہے۔</li>
    <li>ملکیت، انشورنس، اور ریکوری/ری پوزیشن کے معاملات باہمی طے شدہ فریم ورک اور پاکستان کے قوانین کے مطابق ہوں گے۔</li>
    <li>یہ دستاویز سسٹم کے ڈیٹا سے تیار کی گئی ہے۔ دستخط/اسٹیمپ سے پہلے جائزہ ضروری ہے۔</li>
  </ol>
  <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 24px;">
    <div>
      <div style="border-top: 1px solid #9ca3af; padding-top: 6px;">خریدار کے دستخط</div>
      <div style="height: 30px;"></div>
      <div style="border-top: 1px solid #9ca3af; padding-top: 6px;">گواہ #1 (نام/شناختی کارڈ/دستخط)</div>
    </div>
    <div>
      <div style="border-top: 1px solid #9ca3af; padding-top: 6px;">کمپنی کے مجاز دستخط</div>
      <div style="height: 30px;"></div>
      <div style="border-top: 1px solid #9ca3af; padding-top: 6px;">گواہ #2 (نام/شناختی کارڈ/دستخط)</div>
    </div>
  </div>
</div>
`.trim();
  }

  return `
<div style="text-align:center; margin-bottom: 12px;">
  <div style="font-size: 18px; font-weight: 700;">STAMP PAPER AGREEMENT</div>
  <div style="font-size: 12px; color: #6b7280;">(Template for printing. Please review with your legal counsel.)</div>
</div>

<div style="font-size: 14px; line-height: 1.7;">
  <p>This Agreement is made on <strong>{{contractDate}}</strong> between:</p>
  <p><strong>Financier/Seller</strong>: {{companyName}}</p>
  <p><strong>Buyer</strong>: <strong>{{buyerName}}</strong>, CNIC <strong>{{buyerCnic}}</strong>, Address: <strong>{{buyerAddress}}</strong></p>

  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 12px 0;" />

  <p style="font-weight:700;">Contract Information</p>
  <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px 24px;">
    <div><span style="color:#374151;">Contract #:</span> <code>{{contractNumber}}</code></div>
    <div><span style="color:#374151;">Vehicle:</span> {{vehicleLine}}</div>
    <div><span style="color:#374151;">Sale price:</span> {{salePrice}}</div>
    <div><span style="color:#374151;">Principal:</span> {{principalAmount}}</div>
    <div><span style="color:#374151;">Profit rate:</span> {{profitRate}}%</div>
    <div><span style="color:#374151;">Tenure:</span> {{tenureMonths}} months</div>
    <div><span style="color:#374151;">Installment type:</span> {{installmentType}}</div>
    <div><span style="color:#374151;">Schedule start:</span> {{startDate}}</div>
  </div>

  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 12px 0;" />

  <p style="font-weight:700;">Terms &amp; Conditions (sample)</p>
  <ol style="list-style: decimal; padding-left: 18px; margin: 0; display: grid; gap: 8px;">
    <li>The Buyer shall pay installments as per the schedule generated for this contract. Late payment may incur penalties.</li>
    <li>Ownership/possession terms, insurance requirements, and repossession/collection process shall be governed by applicable laws.</li>
    <li>This document is generated from system data and should be reviewed, signed, and stamped as required.</li>
  </ol>

  <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 24px;">
    <div>
      <div style="border-top: 1px solid #9ca3af; padding-top: 6px;">Buyer signature</div>
      <div style="height: 30px;"></div>
      <div style="border-top: 1px solid #9ca3af; padding-top: 6px;">Witness #1 (Name/CNIC/Signature)</div>
    </div>
    <div>
      <div style="border-top: 1px solid #9ca3af; padding-top: 6px;">Company authorized signature</div>
      <div style="height: 30px;"></div>
      <div style="border-top: 1px solid #9ca3af; padding-top: 6px;">Witness #2 (Name/CNIC/Signature)</div>
    </div>
  </div>
</div>
`.trim();
}

function defaultQuotationPrintTemplateHtml(lang: "en" | "ur"): string {
  if (lang === "ur") {
    return `
<div style="font-size: 14px; line-height: 1.7;">
  <div style="display:flex; align-items:flex-start; justify-content:space-between; gap: 16px;">
    <div style="display:flex; align-items:flex-start; gap: 12px;">
      <img src="{{companyLogoUrl}}" alt="" style="display: {{companyLogoDisplay}}; width: 56px; height: 56px; object-fit: contain;" />
      <div>
        <div style="font-size: 20px; font-weight: 800;">کوٹیشن</div>
        <div style="color:#6b7280; margin-top: 2px;">{{companyName}}</div>
      </div>
    </div>
    <div style="text-align:right;">
      <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">#{{quotationNumber}}</div>
      <div style="color:#6b7280;">{{quotationDate}}</div>
    </div>
  </div>

  <hr style="border:none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />

  <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px 24px;">
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">خریدار</span><span>{{buyerName}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">ایجنٹ</span><span>{{agentName}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">کمپین</span><span>{{campaignName}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">اسٹیٹس</span><span>{{quotationStatus}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">آغاز</span><span>{{startDate}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">اقساط کی قسم</span><span>{{installmentType}}</span></div>
  </div>

  <div style="margin-top: 18px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px;">
    <div style="display:flex; align-items:center; justify-content:space-between;">
      <span style="color:#6b7280;">اصل رقم</span>
      <span style="font-size: 18px; font-weight: 800;">{{principalAmount}}</span>
    </div>
    <div style="margin-top: 8px; display:grid; grid-template-columns: 1fr 1fr; gap: 10px 24px;">
      <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">منافع کی شرح</span><span>{{profitRate}}%</span></div>
      <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">مدت</span><span>{{tenureMonths}} ماہ</span></div>
    </div>
  </div>

  <div style="margin-top: 18px;">
    <div style="font-weight: 800; margin-bottom: 8px;">اقساط</div>
    {{installmentsTable}}
  </div>

  <div style="margin-top: 16px; font-size: 12px; color:#6b7280;">Printed on {{printedOn}}</div>

  <hr style="border:none; border-top: 1px solid #e5e7eb; margin: 14px 0;" />
  <div style="display:flex; justify-content:space-between; gap: 12px; font-size: 12px; color:#6b7280;">
    <div>{{companyPhones}}</div>
    <div style="text-align:right;">{{companyAddress}}</div>
  </div>
</div>
`.trim();
  }

  return `
<div style="font-size: 14px; line-height: 1.7;">
  <div style="display:flex; align-items:flex-start; justify-content:space-between; gap: 16px;">
    <div style="display:flex; align-items:flex-start; gap: 12px;">
      <img src="{{companyLogoUrl}}" alt="" style="display: {{companyLogoDisplay}}; width: 56px; height: 56px; object-fit: contain;" />
      <div>
        <div style="font-size: 20px; font-weight: 800;">Quotation</div>
        <div style="color:#6b7280; margin-top: 2px;">{{companyName}}</div>
      </div>
    </div>
    <div style="text-align:right;">
      <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">#{{quotationNumber}}</div>
      <div style="color:#6b7280;">{{quotationDate}}</div>
    </div>
  </div>

  <hr style="border:none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />

  <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px 24px;">
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">Buyer</span><span>{{buyerName}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">Agent</span><span>{{agentName}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">Campaign</span><span>{{campaignName}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">Status</span><span>{{quotationStatus}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">Start date</span><span>{{startDate}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">Installment type</span><span>{{installmentType}}</span></div>
  </div>

  <div style="margin-top: 18px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px;">
    <div style="display:flex; align-items:center; justify-content:space-between;">
      <span style="color:#6b7280;">Principal</span>
      <span style="font-size: 18px; font-weight: 800;">{{principalAmount}}</span>
    </div>
    <div style="margin-top: 8px; display:grid; grid-template-columns: 1fr 1fr; gap: 10px 24px;">
      <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">Profit rate</span><span>{{profitRate}}%</span></div>
      <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">Tenure</span><span>{{tenureMonths}} months</span></div>
    </div>
  </div>

  <div style="margin-top: 18px;">
    <div style="font-weight: 800; margin-bottom: 8px;">Installments</div>
    {{installmentsTable}}
  </div>

  <div style="margin-top: 16px; font-size: 12px; color:#6b7280;">Printed on {{printedOn}}</div>

  <hr style="border:none; border-top: 1px solid #e5e7eb; margin: 14px 0;" />
  <div style="display:flex; justify-content:space-between; gap: 12px; font-size: 12px; color:#6b7280;">
    <div>{{companyPhones}}</div>
    <div style="text-align:right;">{{companyAddress}}</div>
  </div>
</div>
`.trim();
}

function defaultReceiptPrintTemplateHtml(lang: "en" | "ur"): string {
  if (lang === "ur") {
    return `
<div style="font-size: 14px; line-height: 1.7;">
  <div style="display:flex; align-items:flex-start; justify-content:space-between; gap: 16px;">
    <div style="display:flex; align-items:flex-start; gap: 12px;">
      <img src="{{companyLogoUrl}}" alt="" style="display: {{companyLogoDisplay}}; width: 56px; height: 56px; object-fit: contain;" />
      <div>
        <div style="font-size: 20px; font-weight: 800;">رسید</div>
        <div style="color:#6b7280; margin-top: 2px;">{{companyName}}</div>
      </div>
    </div>
    <div style="text-align:right;">
      <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">#{{receiptNumber}}</div>
      <div style="color:#6b7280;">{{receiptDateTime}}</div>
    </div>
  </div>

  <hr style="border:none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />

  <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px 24px;">
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">معاہدہ</span><span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">{{contractNumber}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">خریدار</span><span>{{buyerName}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">ایجنٹ</span><span>{{agentName}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">قسم</span><span>{{receiptType}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">موڈ</span><span>{{paymentMode}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">اسٹیٹ</span><span>{{receiptState}}</span></div>
  </div>

  <div style="margin-top: 10px; display:flex; justify-content:space-between; gap: 12px;">
    <span style="color:#6b7280;">ریفرنس</span>
    <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">{{reference}}</span>
  </div>

  <div style="margin-top: 18px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px;">
    <div style="display:flex; align-items:center; justify-content:space-between;">
      <span style="color:#6b7280;">رقم</span>
      <span style="font-size: 18px; font-weight: 800;">{{amount}}</span>
    </div>
    <div style="margin-top: 8px;">
      <div style="color:#6b7280;">رقم (الفاظ میں)</div>
      <div style="margin-top: 4px;">{{amountWords}}</div>
    </div>
  </div>

  <div style="margin-top: 14px; display: {{noteDisplay}};">
    <div style="color:#6b7280;">نوٹ</div>
    <div style="margin-top: 4px; white-space: pre-wrap;">{{note}}</div>
  </div>

  <div style="margin-top: 16px; font-size: 12px; color:#6b7280;">Printed on {{printedOn}}</div>

  <hr style="border:none; border-top: 1px solid #e5e7eb; margin: 14px 0;" />
  <div style="display:flex; justify-content:space-between; gap: 12px; font-size: 12px; color:#6b7280;">
    <div>{{companyPhones}}</div>
    <div style="text-align:right;">{{companyAddress}}</div>
  </div>
</div>
`.trim();
  }

  return `
<div style="font-size: 14px; line-height: 1.7;">
  <div style="display:flex; align-items:flex-start; justify-content:space-between; gap: 16px;">
    <div style="display:flex; align-items:flex-start; gap: 12px;">
      <img src="{{companyLogoUrl}}" alt="" style="display: {{companyLogoDisplay}}; width: 56px; height: 56px; object-fit: contain;" />
      <div>
        <div style="font-size: 20px; font-weight: 800;">Receipt</div>
        <div style="color:#6b7280; margin-top: 2px;">{{companyName}}</div>
      </div>
    </div>
    <div style="text-align:right;">
      <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">#{{receiptNumber}}</div>
      <div style="color:#6b7280;">{{receiptDateTime}}</div>
    </div>
  </div>

  <hr style="border:none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />

  <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px 24px;">
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">Contract</span><span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">{{contractNumber}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">Buyer</span><span>{{buyerName}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">Agent</span><span>{{agentName}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">Type</span><span>{{receiptType}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">Mode</span><span>{{paymentMode}}</span></div>
    <div style="display:flex; justify-content:space-between; gap: 12px;"><span style="color:#6b7280;">State</span><span>{{receiptState}}</span></div>
  </div>

  <div style="margin-top: 10px; display:flex; justify-content:space-between; gap: 12px;">
    <span style="color:#6b7280;">Reference</span>
    <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">{{reference}}</span>
  </div>

  <div style="margin-top: 18px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px;">
    <div style="display:flex; align-items:center; justify-content:space-between;">
      <span style="color:#6b7280;">Amount</span>
      <span style="font-size: 18px; font-weight: 800;">{{amount}}</span>
    </div>
    <div style="margin-top: 8px;">
      <div style="color:#6b7280;">Amount (in words)</div>
      <div style="margin-top: 4px;">{{amountWords}}</div>
    </div>
  </div>

  <div style="margin-top: 14px; display: {{noteDisplay}};">
    <div style="color:#6b7280;">Note</div>
    <div style="margin-top: 4px; white-space: pre-wrap;">{{note}}</div>
  </div>

  <div style="margin-top: 16px; font-size: 12px; color:#6b7280;">Printed on {{printedOn}}</div>

  <hr style="border:none; border-top: 1px solid #e5e7eb; margin: 14px 0;" />
  <div style="display:flex; justify-content:space-between; gap: 12px; font-size: 12px; color:#6b7280;">
    <div>{{companyPhones}}</div>
    <div style="text-align:right;">{{companyAddress}}</div>
  </div>
</div>
`.trim();
}

function defaultTemplateHtml(key: TemplateKey, lang: "en" | "ur"): string {
  if (key === "STAMP_PAPER_AGREEMENT") return defaultStampPaperTemplateHtml(lang);
  if (key === "QUOTATION_PRINT") return defaultQuotationPrintTemplateHtml(lang);
  return defaultReceiptPrintTemplateHtml(lang);
}

const templateUpsertBody = z
  .object({
    title: z.string().min(1).optional(),
    contents: z.object({
      en: z.string().min(1),
      ur: z.string().min(1)
    })
  })
  .strict();

function ensureTemplatesAvailable() {
  if (typeof (prisma as unknown as { documentTemplate?: unknown }).documentTemplate === "undefined") {
    throw new Error(
      "Prisma client is out of date (documentTemplate missing). Stop the API, run `npx prisma generate`, then restart."
    );
  }
}

templatesRouter.get("/templates", async (_req, res, next) => {
  try {
    res.json(
      serialize(
        TEMPLATE_DEFS.map((t) => ({
          key: t.key,
          title: t.title
        }))
      )
    );
  } catch (e) {
    next(e);
  }
});

templatesRouter.get("/templates/:key", async (req, res, next) => {
  try {
    ensureTemplatesAvailable();
    const companyId = getRequestContext()?.companyId;
    if (!companyId) return res.status(400).json({ error: "Missing tenant. Please login again." });

    const key = String(req.params.key || "").trim().toUpperCase() as TemplateKey;
    if (!TEMPLATE_DEFS.some((d) => d.key === key)) {
      return res.status(404).json({ error: "Template not found" });
    }

    const rows = await (prisma as any).documentTemplate.findMany({
      where: { companyId, key }
    });

    const byLang = new Map<string, any>();
    for (const r of rows as any[]) byLang.set(String(r.lang || "en"), r);

    const title = (byLang.get("en")?.title as string | undefined) ?? TEMPLATE_DEFS.find((d) => d.key === key)!.title;

    res.json(
      serialize({
        key,
        title,
        contents: {
          en: (byLang.get("en")?.content as string | undefined) ?? defaultTemplateHtml(key, "en"),
          ur: (byLang.get("ur")?.content as string | undefined) ?? defaultTemplateHtml(key, "ur")
        }
      })
    );
  } catch (e) {
    next(e);
  }
});

templatesRouter.put("/templates/:key", async (req, res, next) => {
  try {
    ensureTemplatesAvailable();
    const companyId = getRequestContext()?.companyId;
    const branchId = getRequestContext()?.branchId ?? null;
    if (!companyId) return res.status(400).json({ error: "Missing tenant. Please login again." });

    const key = String(req.params.key || "").trim().toUpperCase() as TemplateKey;
    if (!TEMPLATE_DEFS.some((d) => d.key === key)) {
      return res.status(404).json({ error: "Template not found" });
    }

    const body = templateUpsertBody.parse(req.body);
    const title = body.title ?? TEMPLATE_DEFS.find((d) => d.key === key)!.title;

    const upsertOne = async (lang: "en" | "ur", content: string) => {
      return (prisma as any).documentTemplate.upsert({
        where: { companyId_key_lang: { companyId, key, lang } } as any,
        create: { companyId, branchId, key, lang, title, content } as any,
        update: { branchId, title, content } as any
      });
    };

    await Promise.all([upsertOne("en", body.contents.en), upsertOne("ur", body.contents.ur)]);

    const rows = await (prisma as any).documentTemplate.findMany({ where: { companyId, key } });
    const byLang = new Map<string, any>();
    for (const r of rows as any[]) byLang.set(String(r.lang || "en"), r);

    res.json(
      serialize({
        ok: true,
        key,
        title,
        contents: {
          en: (byLang.get("en")?.content as string | undefined) ?? body.contents.en,
          ur: (byLang.get("ur")?.content as string | undefined) ?? body.contents.ur
        }
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

