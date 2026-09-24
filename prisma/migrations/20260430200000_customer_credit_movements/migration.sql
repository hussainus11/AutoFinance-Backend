-- Track customer overpayments (advance), applications, and refunds.

-- Enum for movement type (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'CustomerCreditMovementType'
  ) THEN
    CREATE TYPE "CustomerCreditMovementType" AS ENUM ('OVERPAYMENT','APPLY_TO_CONTRACT','REFUND');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CustomerCreditMovement" (
  "id" TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT NULL,
  "buyerId" TEXT NOT NULL,
  "type" "CustomerCreditMovementType" NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "sourceReceiptId" TEXT NULL,
  "sourceContractId" TEXT NULL,
  "targetContractId" TEXT NULL,
  "note" TEXT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdByUserId" TEXT NULL,
  "createdByName" TEXT NULL
);

-- Indexes (idempotent).
CREATE INDEX IF NOT EXISTS "CustomerCreditMovement_companyId_idx" ON "CustomerCreditMovement" ("companyId");
CREATE INDEX IF NOT EXISTS "CustomerCreditMovement_branchId_idx" ON "CustomerCreditMovement" ("branchId");
CREATE INDEX IF NOT EXISTS "CustomerCreditMovement_buyerId_createdAt_idx" ON "CustomerCreditMovement" ("buyerId","createdAt");
CREATE INDEX IF NOT EXISTS "CustomerCreditMovement_type_createdAt_idx" ON "CustomerCreditMovement" ("type","createdAt");
CREATE INDEX IF NOT EXISTS "CustomerCreditMovement_sourceReceiptId_idx" ON "CustomerCreditMovement" ("sourceReceiptId");
CREATE INDEX IF NOT EXISTS "CustomerCreditMovement_targetContractId_idx" ON "CustomerCreditMovement" ("targetContractId");

-- Unique: one OVERPAYMENT movement per receipt per company.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'CustomerCreditMovement_companyId_sourceReceiptId_type_key'
  ) THEN
    ALTER TABLE "CustomerCreditMovement"
      ADD CONSTRAINT "CustomerCreditMovement_companyId_sourceReceiptId_type_key"
      UNIQUE ("companyId","sourceReceiptId","type");
  END IF;
END $$;

-- Foreign keys (idempotent; guarded by constraint name).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CustomerCreditMovement_companyId_fkey') THEN
    ALTER TABLE "CustomerCreditMovement"
      ADD CONSTRAINT "CustomerCreditMovement_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CustomerCreditMovement_branchId_fkey') THEN
    ALTER TABLE "CustomerCreditMovement"
      ADD CONSTRAINT "CustomerCreditMovement_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CustomerCreditMovement_buyerId_fkey') THEN
    ALTER TABLE "CustomerCreditMovement"
      ADD CONSTRAINT "CustomerCreditMovement_buyerId_fkey"
      FOREIGN KEY ("buyerId") REFERENCES "Partner"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CustomerCreditMovement_sourceReceiptId_fkey') THEN
    ALTER TABLE "CustomerCreditMovement"
      ADD CONSTRAINT "CustomerCreditMovement_sourceReceiptId_fkey"
      FOREIGN KEY ("sourceReceiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CustomerCreditMovement_sourceContractId_fkey') THEN
    ALTER TABLE "CustomerCreditMovement"
      ADD CONSTRAINT "CustomerCreditMovement_sourceContractId_fkey"
      FOREIGN KEY ("sourceContractId") REFERENCES "Contract"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CustomerCreditMovement_targetContractId_fkey') THEN
    ALTER TABLE "CustomerCreditMovement"
      ADD CONSTRAINT "CustomerCreditMovement_targetContractId_fkey"
      FOREIGN KEY ("targetContractId") REFERENCES "Contract"("id") ON DELETE SET NULL;
  END IF;
END $$;

