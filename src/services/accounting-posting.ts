import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";

type PostingConfig = {
  loanReceivableAccountId: string;
  interestIncomeAccountId: string;
  expenseDefaultAccountId: string;
  commissionExpenseAccountId: string;
  commissionPayableAccountId: string;
};

async function getPostingConfigOrThrow(db: any): Promise<PostingConfig> {
  const row = await db.accountingPostingConfig.findFirst({
    select: {
      loanReceivableAccountId: true,
      interestIncomeAccountId: true,
      expenseDefaultAccountId: true,
      commissionExpenseAccountId: true,
      commissionPayableAccountId: true
    }
  });
  if (!row) {
    throw new Error("Accounting posting config is not set. Please configure Accounting → Posting rules.");
  }
  return row;
}

async function pickBankAccountIdFromPaymentMode(db: any, paymentMode: string | null | undefined): Promise<string> {
  const pm = (paymentMode ?? "").trim();
  if (pm) {
    const match = await db.accountingBankAccount.findFirst({
      where: { isActive: true, name: { equals: pm, mode: "insensitive" } },
      select: { accountId: true }
    });
    if (match?.accountId) return match.accountId;
  }
  const first = await db.accountingBankAccount.findFirst({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { accountId: true }
  });
  if (!first?.accountId) {
    throw new Error("No active bank/cash account configured. Create one in Accounting → Bank accounts.");
  }
  return first.accountId;
}

function sumDecimal(list: Array<Prisma.Decimal>): Prisma.Decimal {
  return list.reduce((s, v) => s.add(v), new Prisma.Decimal(0));
}

async function postReceiptJournalEntryTx(tx: any, receiptId: string): Promise<void> {
  const cfg = await getPostingConfigOrThrow(tx);
  const receipt = await tx.receipt.findUnique({
    where: { id: receiptId },
    include: {
      allocations: true
    }
  });
  if (!receipt) throw new Error("Receipt not found");

  // Avoid duplicate posting (idempotent)
  const existing = await tx.journalEntry.findFirst({
    where: { sourceType: "RECEIPT", sourceId: receipt.id, status: "POSTED" },
    select: { id: true }
  });
  if (existing) return;

  const bankAccountId = await pickBankAccountIdFromPaymentMode(tx, receipt.paymentMode);

  const principal = sumDecimal(
    (receipt.allocations ?? [])
      .filter((a: any) => String(a.component ?? "").toUpperCase() === "PRINCIPAL")
      .map((a: any) => a.amount as Prisma.Decimal)
  );
  const interest = sumDecimal(
    (receipt.allocations ?? [])
      .filter((a: any) => String(a.component ?? "").toUpperCase() === "INTEREST")
      .map((a: any) => a.amount as Prisma.Decimal)
  );

  // If allocations aren't split, treat all as principal.
  const hasSplit = principal.gt(0) || interest.gt(0);
  const creditLoan = hasSplit ? principal : (receipt.amount as any as Prisma.Decimal);
  const creditInterest = hasSplit ? interest : new Prisma.Decimal(0);

  const debitCash = (receipt.amount as any as Prisma.Decimal);

  // Balance guard (cash basis): debit total must equal credit total
  const creditTotal = creditLoan.add(creditInterest);
  if (!debitCash.eq(creditTotal)) {
    // If it doesn't match (partial allocation), fallback: credit all to loan receivable.
    // This keeps books balanced while allocation details catch up.
    // (Still view-only; can be improved later.)
    const fallbackCreditLoan = debitCash;
    const je = await tx.journalEntry.create({
      data: {
        status: "POSTED",
        entryDate: receipt.receivedAt ?? new Date(),
        memo: `Receipt ${receipt.reference ?? receipt.id.slice(0, 8)}`,
        sourceType: "RECEIPT",
        sourceId: receipt.id,
        company: { connect: { id: receipt.companyId } },
        ...(receipt.branchId ? { branch: { connect: { id: receipt.branchId } } } : {})
      } as any
    });
    await tx.journalLine.createMany({
      data: [
        { entryId: je.id, accountId: bankAccountId, companyId: receipt.companyId, branchId: receipt.branchId, debit: debitCash, credit: new Prisma.Decimal(0) },
        { entryId: je.id, accountId: cfg.loanReceivableAccountId, companyId: receipt.companyId, branchId: receipt.branchId, debit: new Prisma.Decimal(0), credit: fallbackCreditLoan }
      ] as any
    });
    return;
  }

  const je = await tx.journalEntry.create({
    data: {
      status: "POSTED",
      entryDate: receipt.receivedAt ?? new Date(),
      memo: `Receipt ${receipt.reference ?? receipt.id.slice(0, 8)}`,
      sourceType: "RECEIPT",
      sourceId: receipt.id,
      company: { connect: { id: receipt.companyId } },
      ...(receipt.branchId ? { branch: { connect: { id: receipt.branchId } } } : {})
    } as any
  });
  const lines: any[] = [
    {
      entryId: je.id,
      accountId: bankAccountId,
      companyId: receipt.companyId,
      branchId: receipt.branchId,
      debit: debitCash,
      credit: new Prisma.Decimal(0)
    },
    {
      entryId: je.id,
      accountId: cfg.loanReceivableAccountId,
      companyId: receipt.companyId,
      branchId: receipt.branchId,
      debit: new Prisma.Decimal(0),
      credit: creditLoan
    }
  ];
  if (creditInterest.gt(0)) {
    lines.push({
      entryId: je.id,
      accountId: cfg.interestIncomeAccountId,
      companyId: receipt.companyId,
      branchId: receipt.branchId,
      debit: new Prisma.Decimal(0),
      credit: creditInterest
    });
  }
  await tx.journalLine.createMany({ data: lines as any });
}

export async function postReceiptJournalEntry(receiptId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await postReceiptJournalEntryTx(tx, receiptId);
  });
}

export async function postReceiptJournalEntryInTx(tx: any, receiptId: string): Promise<void> {
  await postReceiptJournalEntryTx(tx, receiptId);
}

export async function postExpenseJournalEntry(expenseId: string): Promise<void> {
  const cfg = await getPostingConfigOrThrow(prisma);
  const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!expense) throw new Error("Expense not found");

  const existing = await prisma.journalEntry.findFirst({
    where: { sourceType: "EXPENSE", sourceId: expense.id, status: "POSTED" },
    select: { id: true }
  });
  if (existing) return;

  const bankAccountId = await pickBankAccountIdFromPaymentMode(prisma, (expense as any).paymentMode);
  const amount = expense.amount as any as Prisma.Decimal;

  await prisma.$transaction(async (tx) => {
    const je = await tx.journalEntry.create({
      data: {
        status: "POSTED",
        entryDate: expense.expenseDate ?? new Date(),
        memo: `Expense ${expense.description}`,
        sourceType: "EXPENSE",
        sourceId: expense.id,
        company: { connect: { id: expense.companyId } },
        ...(expense.branchId ? { branch: { connect: { id: expense.branchId } } } : {})
      } as any
    });
    await tx.journalLine.createMany({
      data: [
        { entryId: je.id, accountId: cfg.expenseDefaultAccountId, companyId: expense.companyId, branchId: expense.branchId, debit: amount, credit: new Prisma.Decimal(0) },
        { entryId: je.id, accountId: bankAccountId, companyId: expense.companyId, branchId: expense.branchId, debit: new Prisma.Decimal(0), credit: amount }
      ] as any
    });
  });
}

export async function postCommissionPaidJournalEntry(commissionId: string): Promise<void> {
  const cfg = await getPostingConfigOrThrow(prisma);
  const row = await prisma.commission.findUnique({ where: { id: commissionId } });
  if (!row) throw new Error("Commission not found");
  if (row.status !== "PAID") return;

  const existing = await prisma.journalEntry.findFirst({
    where: { sourceType: "COMMISSION", sourceId: row.id, status: "POSTED" },
    select: { id: true }
  });
  if (existing) return;

  // PaymentMode isn't on commission. For now, post to first active bank/cash account.
  const bankAccountId = await pickBankAccountIdFromPaymentMode(prisma, null);
  const amount = row.amount as any as Prisma.Decimal;

  await prisma.$transaction(async (tx) => {
    const je = await tx.journalEntry.create({
      data: {
        status: "POSTED",
        entryDate: row.paidAt ?? new Date(),
        memo: "Commission paid",
        sourceType: "COMMISSION",
        sourceId: row.id,
        company: { connect: { id: row.companyId } },
        ...(row.branchId ? { branch: { connect: { id: row.branchId } } } : {})
      } as any
    });
    await tx.journalLine.createMany({
      data: [
        { entryId: je.id, accountId: cfg.commissionExpenseAccountId, companyId: row.companyId, branchId: row.branchId, debit: amount, credit: new Prisma.Decimal(0) },
        { entryId: je.id, accountId: bankAccountId, companyId: row.companyId, branchId: row.branchId, debit: new Prisma.Decimal(0), credit: amount }
      ] as any
    });
  });
}

