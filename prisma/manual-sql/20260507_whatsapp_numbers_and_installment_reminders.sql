-- Run this if your DB isn't migrated yet but the app expects WhatsApp reminders.
-- Usage:
--   npx prisma db execute --file prisma/manual-sql/20260507_whatsapp_numbers_and_installment_reminders.sql

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "whatsappNumber" TEXT;

ALTER TABLE "Branch"
  ADD COLUMN IF NOT EXISTS "whatsappNumber" TEXT;

CREATE TABLE IF NOT EXISTS "InstallmentReminderLog" (
  "id" TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT NULL,
  "contractId" TEXT NOT NULL,
  "installmentId" TEXT NOT NULL,
  "runDate" TEXT NOT NULL,
  "daysBefore" INTEGER NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
  "fromNumber" TEXT NULL,
  "toNumber" TEXT NULL,
  "message" TEXT NULL,
  "status" TEXT NOT NULL DEFAULT 'SENT',
  "error" TEXT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Idempotent indexes / constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InstallmentReminderLog_installmentId_runDate_daysBefore_channel_key'
  ) THEN
    ALTER TABLE "InstallmentReminderLog"
      ADD CONSTRAINT "InstallmentReminderLog_installmentId_runDate_daysBefore_channel_key"
      UNIQUE ("installmentId","runDate","daysBefore","channel");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "InstallmentReminderLog_companyId_idx" ON "InstallmentReminderLog" ("companyId");
CREATE INDEX IF NOT EXISTS "InstallmentReminderLog_branchId_idx" ON "InstallmentReminderLog" ("branchId");
CREATE INDEX IF NOT EXISTS "InstallmentReminderLog_contractId_idx" ON "InstallmentReminderLog" ("contractId");
CREATE INDEX IF NOT EXISTS "InstallmentReminderLog_installmentId_idx" ON "InstallmentReminderLog" ("installmentId");

-- Branch-level encrypted config store (Meta WhatsApp Cloud API, etc.)
CREATE TABLE IF NOT EXISTS "BranchSecretConfig" (
  "companyId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "valueEnc" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("companyId","branchId","key")
);

CREATE INDEX IF NOT EXISTS "BranchSecretConfig_branchId_idx" ON "BranchSecretConfig" ("branchId");

-- Company-level encrypted config (customer's own Meta App credentials)
CREATE TABLE IF NOT EXISTS "CompanySecretConfig" (
  "companyId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "valueEnc" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("companyId","key")
);

CREATE INDEX IF NOT EXISTS "CompanySecretConfig_companyId_idx" ON "CompanySecretConfig" ("companyId");

