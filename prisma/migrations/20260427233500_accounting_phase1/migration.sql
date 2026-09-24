-- Accounting Phase 1: COA + bank accounts + journal entries/lines + posting config

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t WHERE t.typname = 'AccountingAccountType') THEN
    CREATE TYPE "AccountingAccountType" AS ENUM ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t WHERE t.typname = 'AccountingNormalBalance') THEN
    CREATE TYPE "AccountingNormalBalance" AS ENUM ('DEBIT','CREDIT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t WHERE t.typname = 'JournalEntryStatus') THEN
    CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT','POSTED','VOID');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t WHERE t.typname = 'JournalSourceType') THEN
    CREATE TYPE "JournalSourceType" AS ENUM ('MANUAL','RECEIPT','EXPENSE','COMMISSION','RECOVERY_FEE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "AccountingAccount" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "code" TEXT,
  "name" TEXT NOT NULL,
  "type" "AccountingAccountType" NOT NULL,
  "normalBalance" "AccountingNormalBalance" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdByUserId" TEXT,
  "createdByName" TEXT,
  "updatedByUserId" TEXT,
  "updatedByName" TEXT,
  CONSTRAINT "AccountingAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AccountingAccount_companyId_name_key" ON "AccountingAccount"("companyId","name");
CREATE INDEX IF NOT EXISTS "AccountingAccount_companyId_idx" ON "AccountingAccount"("companyId");
CREATE INDEX IF NOT EXISTS "AccountingAccount_branchId_idx" ON "AccountingAccount"("branchId");
CREATE INDEX IF NOT EXISTS "AccountingAccount_type_idx" ON "AccountingAccount"("type");
CREATE INDEX IF NOT EXISTS "AccountingAccount_isActive_idx" ON "AccountingAccount"("isActive");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountingAccount_companyId_fkey') THEN
    ALTER TABLE "AccountingAccount"
    ADD CONSTRAINT "AccountingAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountingAccount_branchId_fkey') THEN
    ALTER TABLE "AccountingAccount"
    ADD CONSTRAINT "AccountingAccount_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "AccountingBankAccount" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "accountId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdByUserId" TEXT,
  "createdByName" TEXT,
  "updatedByUserId" TEXT,
  "updatedByName" TEXT,
  CONSTRAINT "AccountingBankAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AccountingBankAccount_companyId_name_key" ON "AccountingBankAccount"("companyId","name");
CREATE UNIQUE INDEX IF NOT EXISTS "AccountingBankAccount_accountId_key" ON "AccountingBankAccount"("accountId");
CREATE INDEX IF NOT EXISTS "AccountingBankAccount_companyId_idx" ON "AccountingBankAccount"("companyId");
CREATE INDEX IF NOT EXISTS "AccountingBankAccount_branchId_idx" ON "AccountingBankAccount"("branchId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountingBankAccount_companyId_fkey') THEN
    ALTER TABLE "AccountingBankAccount"
    ADD CONSTRAINT "AccountingBankAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountingBankAccount_branchId_fkey') THEN
    ALTER TABLE "AccountingBankAccount"
    ADD CONSTRAINT "AccountingBankAccount_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountingBankAccount_accountId_fkey') THEN
    ALTER TABLE "AccountingBankAccount"
    ADD CONSTRAINT "AccountingBankAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AccountingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "JournalEntry" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "entryDate" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "status" "JournalEntryStatus" NOT NULL DEFAULT 'POSTED',
  "memo" TEXT,
  "sourceType" "JournalSourceType" NOT NULL DEFAULT 'MANUAL',
  "sourceId" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdByUserId" TEXT,
  "createdByName" TEXT,
  "updatedByUserId" TEXT,
  "updatedByName" TEXT,
  CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "JournalEntry_companyId_idx" ON "JournalEntry"("companyId");
CREATE INDEX IF NOT EXISTS "JournalEntry_branchId_idx" ON "JournalEntry"("branchId");
CREATE INDEX IF NOT EXISTS "JournalEntry_entryDate_idx" ON "JournalEntry"("entryDate");
CREATE INDEX IF NOT EXISTS "JournalEntry_status_idx" ON "JournalEntry"("status");
CREATE INDEX IF NOT EXISTS "JournalEntry_sourceType_sourceId_idx" ON "JournalEntry"("sourceType","sourceId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalEntry_companyId_fkey') THEN
    ALTER TABLE "JournalEntry"
    ADD CONSTRAINT "JournalEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalEntry_branchId_fkey') THEN
    ALTER TABLE "JournalEntry"
    ADD CONSTRAINT "JournalEntry_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalEntry_createdByUserId_fkey') THEN
    ALTER TABLE "JournalEntry"
    ADD CONSTRAINT "JournalEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalEntry_updatedByUserId_fkey') THEN
    ALTER TABLE "JournalEntry"
    ADD CONSTRAINT "JournalEntry_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "JournalLine" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "entryId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "note" TEXT,
  CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "JournalLine_companyId_idx" ON "JournalLine"("companyId");
CREATE INDEX IF NOT EXISTS "JournalLine_branchId_idx" ON "JournalLine"("branchId");
CREATE INDEX IF NOT EXISTS "JournalLine_entryId_idx" ON "JournalLine"("entryId");
CREATE INDEX IF NOT EXISTS "JournalLine_accountId_idx" ON "JournalLine"("accountId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalLine_companyId_fkey') THEN
    ALTER TABLE "JournalLine"
    ADD CONSTRAINT "JournalLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalLine_branchId_fkey') THEN
    ALTER TABLE "JournalLine"
    ADD CONSTRAINT "JournalLine_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalLine_entryId_fkey') THEN
    ALTER TABLE "JournalLine"
    ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalLine_accountId_fkey') THEN
    ALTER TABLE "JournalLine"
    ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "AccountingPostingConfig" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "loanReceivableAccountId" TEXT NOT NULL,
  "interestIncomeAccountId" TEXT NOT NULL,
  "expenseDefaultAccountId" TEXT NOT NULL,
  "commissionExpenseAccountId" TEXT NOT NULL,
  "commissionPayableAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdByUserId" TEXT,
  "createdByName" TEXT,
  "updatedByUserId" TEXT,
  "updatedByName" TEXT,
  CONSTRAINT "AccountingPostingConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AccountingPostingConfig_companyId_key" ON "AccountingPostingConfig"("companyId");
CREATE INDEX IF NOT EXISTS "AccountingPostingConfig_branchId_idx" ON "AccountingPostingConfig"("branchId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountingPostingConfig_companyId_fkey') THEN
    ALTER TABLE "AccountingPostingConfig"
    ADD CONSTRAINT "AccountingPostingConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountingPostingConfig_branchId_fkey') THEN
    ALTER TABLE "AccountingPostingConfig"
    ADD CONSTRAINT "AccountingPostingConfig_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Account mapping FKs
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountingPostingConfig_loanReceivableAccountId_fkey') THEN
    ALTER TABLE "AccountingPostingConfig"
    ADD CONSTRAINT "AccountingPostingConfig_loanReceivableAccountId_fkey" FOREIGN KEY ("loanReceivableAccountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountingPostingConfig_interestIncomeAccountId_fkey') THEN
    ALTER TABLE "AccountingPostingConfig"
    ADD CONSTRAINT "AccountingPostingConfig_interestIncomeAccountId_fkey" FOREIGN KEY ("interestIncomeAccountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountingPostingConfig_expenseDefaultAccountId_fkey') THEN
    ALTER TABLE "AccountingPostingConfig"
    ADD CONSTRAINT "AccountingPostingConfig_expenseDefaultAccountId_fkey" FOREIGN KEY ("expenseDefaultAccountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountingPostingConfig_commissionExpenseAccountId_fkey') THEN
    ALTER TABLE "AccountingPostingConfig"
    ADD CONSTRAINT "AccountingPostingConfig_commissionExpenseAccountId_fkey" FOREIGN KEY ("commissionExpenseAccountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountingPostingConfig_commissionPayableAccountId_fkey') THEN
    ALTER TABLE "AccountingPostingConfig"
    ADD CONSTRAINT "AccountingPostingConfig_commissionPayableAccountId_fkey" FOREIGN KEY ("commissionPayableAccountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

