-- Multi-tenancy foundation: add companyId (required) and branchId (nullable) to all domain tables.
-- Backfill strategy:
-- - Create a default Company and Branch if missing.
-- - Add columns with defaults for existing rows.
-- - Add foreign keys and indexes.
--
-- NOTE: This uses fixed UUIDs for the default tenant to allow NOT NULL + default.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Company" WHERE id = '00000000-0000-0000-0000-000000000001') THEN
    INSERT INTO "Company" (id, name, "isActive", "createdAt", "updatedAt")
    VALUES ('00000000-0000-0000-0000-000000000001', 'Default Company', true, NOW(), NOW());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "Branch" WHERE id = '00000000-0000-0000-0000-000000000002') THEN
    INSERT INTO "Branch" (id, "companyId", name, "isActive", "createdAt", "updatedAt")
    VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Default Branch', true, NOW(), NOW());
  END IF;
END $$;

-- Helper: add (companyId, branchId) if missing.
-- We intentionally avoid CREATE DOMAIN / functions to keep deploy simple.

-- FinanceChart
ALTER TABLE "FinanceChart" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "FinanceChart" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "FinanceChart" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "FinanceChart" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "FinanceChart_companyId_idx" ON "FinanceChart"("companyId");
CREATE INDEX IF NOT EXISTS "FinanceChart_branchId_idx" ON "FinanceChart"("branchId");

-- Partner & related
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "Partner" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "Partner" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "Partner_companyId_idx" ON "Partner"("companyId");
CREATE INDEX IF NOT EXISTS "Partner_branchId_idx" ON "Partner"("branchId");

ALTER TABLE "PartnerPhone" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "PartnerPhone" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "PartnerPhone" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "PartnerPhone" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "PartnerPhone_companyId_idx" ON "PartnerPhone"("companyId");
CREATE INDEX IF NOT EXISTS "PartnerPhone_branchId_idx" ON "PartnerPhone"("branchId");

ALTER TABLE "PartnerEmail" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "PartnerEmail" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "PartnerEmail" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "PartnerEmail" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "PartnerEmail_companyId_idx" ON "PartnerEmail"("companyId");
CREATE INDEX IF NOT EXISTS "PartnerEmail_branchId_idx" ON "PartnerEmail"("branchId");

ALTER TABLE "PartnerAddress" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "PartnerAddress" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "PartnerAddress" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "PartnerAddress" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "PartnerAddress_companyId_idx" ON "PartnerAddress"("companyId");
CREATE INDEX IF NOT EXISTS "PartnerAddress_branchId_idx" ON "PartnerAddress"("branchId");

ALTER TABLE "PartnerDocument" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "PartnerDocument" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "PartnerDocument" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "PartnerDocument" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "PartnerDocument_companyId_idx" ON "PartnerDocument"("companyId");
CREATE INDEX IF NOT EXISTS "PartnerDocument_branchId_idx" ON "PartnerDocument"("branchId");

-- Vehicle & images
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "Vehicle" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "Vehicle" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "Vehicle_companyId_idx" ON "Vehicle"("companyId");
CREATE INDEX IF NOT EXISTS "Vehicle_branchId_idx" ON "Vehicle"("branchId");

ALTER TABLE "VehicleImage" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "VehicleImage" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "VehicleImage" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "VehicleImage" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "VehicleImage_companyId_idx" ON "VehicleImage"("companyId");
CREATE INDEX IF NOT EXISTS "VehicleImage_branchId_idx" ON "VehicleImage"("branchId");

-- Campaign & junction tables
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "Campaign" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "Campaign" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "Campaign_companyId_idx" ON "Campaign"("companyId");
CREATE INDEX IF NOT EXISTS "Campaign_branchId_idx" ON "Campaign"("branchId");

ALTER TABLE "CampaignVehicle" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "CampaignVehicle" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "CampaignVehicle" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "CampaignVehicle" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "CampaignVehicle_companyId_idx" ON "CampaignVehicle"("companyId");
CREATE INDEX IF NOT EXISTS "CampaignVehicle_branchId_idx" ON "CampaignVehicle"("branchId");

ALTER TABLE "CampaignChart" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "CampaignChart" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "CampaignChart" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "CampaignChart" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "CampaignChart_companyId_idx" ON "CampaignChart"("companyId");
CREATE INDEX IF NOT EXISTS "CampaignChart_branchId_idx" ON "CampaignChart"("branchId");

-- Contract and related
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "Contract" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "Contract" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "Contract_companyId_idx" ON "Contract"("companyId");
CREATE INDEX IF NOT EXISTS "Contract_branchId_idx" ON "Contract"("branchId");

ALTER TABLE "ContractVehicle" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "ContractVehicle" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "ContractVehicle" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "ContractVehicle" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "ContractVehicle_companyId_idx" ON "ContractVehicle"("companyId");
CREATE INDEX IF NOT EXISTS "ContractVehicle_branchId_idx" ON "ContractVehicle"("branchId");

ALTER TABLE "ContractGuarantor" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "ContractGuarantor" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "ContractGuarantor" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "ContractGuarantor" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "ContractGuarantor_companyId_idx" ON "ContractGuarantor"("companyId");
CREATE INDEX IF NOT EXISTS "ContractGuarantor_branchId_idx" ON "ContractGuarantor"("branchId");

ALTER TABLE "Installment" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Installment" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "Installment" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "Installment" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "Installment_companyId_idx" ON "Installment"("companyId");
CREATE INDEX IF NOT EXISTS "Installment_branchId_idx" ON "Installment"("branchId");

ALTER TABLE "InstallmentHistory" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "InstallmentHistory" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "InstallmentHistory" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "InstallmentHistory" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "InstallmentHistory_companyId_idx" ON "InstallmentHistory"("companyId");
CREATE INDEX IF NOT EXISTS "InstallmentHistory_branchId_idx" ON "InstallmentHistory"("branchId");

ALTER TABLE "RestructureRequest" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "RestructureRequest" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "RestructureRequest" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "RestructureRequest" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "RestructureRequest_companyId_idx" ON "RestructureRequest"("companyId");
CREATE INDEX IF NOT EXISTS "RestructureRequest_branchId_idx" ON "RestructureRequest"("branchId");

ALTER TABLE "LateFeeWaiver" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "LateFeeWaiver" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "LateFeeWaiver" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "LateFeeWaiver" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "LateFeeWaiver_companyId_idx" ON "LateFeeWaiver"("companyId");
CREATE INDEX IF NOT EXISTS "LateFeeWaiver_branchId_idx" ON "LateFeeWaiver"("branchId");

ALTER TABLE "ProcessRun" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "ProcessRun" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "ProcessRun" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "ProcessRun" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "ProcessRun_companyId_idx" ON "ProcessRun"("companyId");
CREATE INDEX IF NOT EXISTS "ProcessRun_branchId_idx" ON "ProcessRun"("branchId");

ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "Receipt" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "Receipt" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "Receipt_companyId_idx" ON "Receipt"("companyId");
CREATE INDEX IF NOT EXISTS "Receipt_branchId_idx" ON "Receipt"("branchId");

ALTER TABLE "ReceiptAllocation" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "ReceiptAllocation" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "ReceiptAllocation" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "ReceiptAllocation" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "ReceiptAllocation_companyId_idx" ON "ReceiptAllocation"("companyId");
CREATE INDEX IF NOT EXISTS "ReceiptAllocation_branchId_idx" ON "ReceiptAllocation"("branchId");

ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "Commission" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "Commission" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "Commission_companyId_idx" ON "Commission"("companyId");
CREATE INDEX IF NOT EXISTS "Commission_branchId_idx" ON "Commission"("branchId");

ALTER TABLE "RecoveryCase" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "RecoveryCase" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "RecoveryCase" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "RecoveryCase" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "RecoveryCase_companyId_idx" ON "RecoveryCase"("companyId");
CREATE INDEX IF NOT EXISTS "RecoveryCase_branchId_idx" ON "RecoveryCase"("branchId");

-- Expenses
ALTER TABLE "ExpenseCategory" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "ExpenseCategory" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "ExpenseCategory" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "ExpenseCategory" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "ExpenseCategory_companyId_idx" ON "ExpenseCategory"("companyId");
CREATE INDEX IF NOT EXISTS "ExpenseCategory_branchId_idx" ON "ExpenseCategory"("branchId");

ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "Expense" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "Expense" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "Expense_companyId_idx" ON "Expense"("companyId");
CREATE INDEX IF NOT EXISTS "Expense_branchId_idx" ON "Expense"("branchId");

-- Quotations
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "Quotation" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "Quotation" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "Quotation_companyId_idx" ON "Quotation"("companyId");
CREATE INDEX IF NOT EXISTS "Quotation_branchId_idx" ON "Quotation"("branchId");

ALTER TABLE "QuotationVehicle" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "QuotationVehicle" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "QuotationVehicle" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "QuotationVehicle" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "QuotationVehicle_companyId_idx" ON "QuotationVehicle"("companyId");
CREATE INDEX IF NOT EXISTS "QuotationVehicle_branchId_idx" ON "QuotationVehicle"("branchId");

ALTER TABLE "QuotationGuarantor" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "QuotationGuarantor" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "QuotationGuarantor" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "QuotationGuarantor" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "QuotationGuarantor_companyId_idx" ON "QuotationGuarantor"("companyId");
CREATE INDEX IF NOT EXISTS "QuotationGuarantor_branchId_idx" ON "QuotationGuarantor"("branchId");

ALTER TABLE "QuotationInstallment" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "QuotationInstallment" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "QuotationInstallment" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "QuotationInstallment" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "QuotationInstallment_companyId_idx" ON "QuotationInstallment"("companyId");
CREATE INDEX IF NOT EXISTS "QuotationInstallment_branchId_idx" ON "QuotationInstallment"("branchId");

-- Task queue
ALTER TABLE "TaskQueueRequest" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "TaskQueueRequest" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "TaskQueueRequest" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "TaskQueueRequest" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "TaskQueueRequest_companyId_idx" ON "TaskQueueRequest"("companyId");
CREATE INDEX IF NOT EXISTS "TaskQueueRequest_branchId_idx" ON "TaskQueueRequest"("branchId");

-- Foreign keys (add if not exists)
DO $$
BEGIN
  -- Company FKs
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FinanceChart_companyId_fkey') THEN
    ALTER TABLE "FinanceChart" ADD CONSTRAINT "FinanceChart_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Partner_companyId_fkey') THEN
    ALTER TABLE "Partner" ADD CONSTRAINT "Partner_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Vehicle_companyId_fkey') THEN
    ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Campaign_companyId_fkey') THEN
    ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Contract_companyId_fkey') THEN
    ALTER TABLE "Contract" ADD CONSTRAINT "Contract_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Quotation_companyId_fkey') THEN
    ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Receipt_companyId_fkey') THEN
    ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExpenseCategory_companyId_fkey') THEN
    ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Expense_companyId_fkey') THEN
    ALTER TABLE "Expense" ADD CONSTRAINT "Expense_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskQueueRequest_companyId_fkey') THEN
    ALTER TABLE "TaskQueueRequest" ADD CONSTRAINT "TaskQueueRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Ensure SystemConfig exists for shadow DB replays.
-- Older environments may have created this table manually; make migration replay-safe.
CREATE TABLE IF NOT EXISTS "SystemConfig" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Fallback for environments where the table was created unquoted (lowercased).
CREATE TABLE IF NOT EXISTS systemconfig (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SystemConfig (make company-scoped)
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "SystemConfig" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
ALTER TABLE "SystemConfig" ALTER COLUMN "companyId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "SystemConfig_branchId_idx" ON "SystemConfig"("branchId");

-- Rebuild PK to (companyId, key) if it's still just (key)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'SystemConfig'::regclass
      AND contype = 'p'
      AND conname = 'SystemConfig_pkey'
  ) THEN
    -- drop existing PK (key) and recreate composite PK
    ALTER TABLE "SystemConfig" DROP CONSTRAINT "SystemConfig_pkey";
    ALTER TABLE "SystemConfig" ADD CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("companyId", "key");
  END IF;
END $$;

-- AuditLog tenant columns
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
UPDATE "AuditLog" SET "companyId" = '00000000-0000-0000-0000-000000000001' WHERE "companyId" IS NULL;
CREATE INDEX IF NOT EXISTS "AuditLog_companyId_idx" ON "AuditLog"("companyId");
CREATE INDEX IF NOT EXISTS "AuditLog_branchId_idx" ON "AuditLog"("branchId");

