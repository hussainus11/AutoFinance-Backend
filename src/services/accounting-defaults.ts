import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

type DbLike = Pick<
  PrismaClient,
  "company" | "accountingAccount" | "accountingBankAccount" | "accountingPostingConfig" | "$transaction"
>;

type TenantIds = { companyId: string; branchId?: string | null };

type DefaultAccount = {
  key: string;
  code: string;
  nameEn: string;
  nameUr: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
  normalBalance: "DEBIT" | "CREDIT";
};

const DEFAULT_ACCOUNTS: DefaultAccount[] = [
  { key: "cash", code: "1000", nameEn: "Cash", nameUr: "نقد", type: "ASSET", normalBalance: "DEBIT" },
  { key: "bank", code: "1010", nameEn: "Bank", nameUr: "بینک", type: "ASSET", normalBalance: "DEBIT" },
  { key: "loanReceivable", code: "1100", nameEn: "Loan receivable", nameUr: "لون رسیویبل", type: "ASSET", normalBalance: "DEBIT" },

  { key: "commissionPayable", code: "2000", nameEn: "Commission payable", nameUr: "کمیشن پےایبل", type: "LIABILITY", normalBalance: "CREDIT" },

  { key: "ownerEquity", code: "3000", nameEn: "Owner equity", nameUr: "مالک سرمایہ", type: "EQUITY", normalBalance: "CREDIT" },

  { key: "interestIncome", code: "4000", nameEn: "Interest income", nameUr: "منافع آمدن", type: "INCOME", normalBalance: "CREDIT" },
  { key: "otherIncome", code: "4100", nameEn: "Other income", nameUr: "دیگر آمدن", type: "INCOME", normalBalance: "CREDIT" },

  { key: "operatingExpense", code: "5000", nameEn: "Operating expense", nameUr: "عملیاتی اخراجات", type: "EXPENSE", normalBalance: "DEBIT" },
  { key: "commissionExpense", code: "5100", nameEn: "Commission expense", nameUr: "کمیشن اخراجات", type: "EXPENSE", normalBalance: "DEBIT" }
];

export async function ensureDefaultAccounting(db: DbLike, tenant: TenantIds): Promise<void> {
  const companyId = tenant.companyId;
  const branchId = tenant.branchId ?? null;

  const run = async (tx: any) => {
    // Guard: if tenant company doesn't exist, don't crash with FK errors.
    const company = await tx.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!company) throw new Error("Company not found for accounting defaults. Please login again.");

    // Upsert accounts idempotently (safe if partially seeded earlier).
    const ids = new Map<string, string>();
    for (const a of DEFAULT_ACCOUNTS) {
      const id = randomUUID();
      const row = await tx.accountingAccount.upsert({
        where: { companyId_name: { companyId, name: a.nameEn } } as any,
        create: {
          id,
          companyId,
          branchId,
          code: a.code,
          name: a.nameEn,
          nameUr: a.nameUr,
          type: a.type as any,
          normalBalance: a.normalBalance as any,
          isActive: true
        } as any,
        update: {
          // Keep tenant-scoped, but allow improving defaults without breaking existing users.
          code: a.code,
          nameUr: a.nameUr,
          type: a.type as any,
          normalBalance: a.normalBalance as any,
          isActive: true
        } as any,
        select: { id: true }
      });
      ids.set(a.key, row.id);
    }

    // Map payment modes to bank/cash accounts (used by auto-posting)
    const cashAccountId = ids.get("cash")!;
    const bankAccountId = ids.get("bank")!;

    const bankRows = [
      { name: "CASH", accountId: cashAccountId },
      { name: "BANK_TRANSFER", accountId: bankAccountId },
      { name: "CARD", accountId: bankAccountId },
      { name: "CHEQUE", accountId: bankAccountId }
    ];

    for (const b of bankRows) {
      // Idempotency guard (unique by companyId+name and unique accountId)
      const exists = await tx.accountingBankAccount.findFirst({
        where: { companyId, OR: [{ name: b.name }, { accountId: b.accountId }] },
        select: { id: true }
      });
      if (exists) continue;
      await tx.accountingBankAccount.create({
        data: {
          id: randomUUID(),
          companyId,
          branchId,
          name: b.name,
          isActive: true,
          accountId: b.accountId
        } as any
      });
    }

    // Posting rules defaults (cash basis)
    await tx.accountingPostingConfig.upsert({
      where: { companyId } as any,
      create: {
        id: randomUUID(),
        companyId,
        branchId,
        loanReceivableAccountId: ids.get("loanReceivable")!,
        interestIncomeAccountId: ids.get("interestIncome")!,
        expenseDefaultAccountId: ids.get("operatingExpense")!,
        commissionExpenseAccountId: ids.get("commissionExpense")!,
        commissionPayableAccountId: ids.get("commissionPayable")!
      } as any,
      update: {} as any
    });
  };

  // If called with a transaction client (`tx`), it won't have `$transaction`.
  if (typeof (db as any).$transaction === "function") {
    await (db as any).$transaction(run);
  } else {
    await run(db as any);
  }
}

