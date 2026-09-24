-- Add audit columns to ReceiptAllocation (idempotent)

ALTER TABLE "ReceiptAllocation"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "createdByName" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedByName" TEXT;

UPDATE "ReceiptAllocation"
SET "updatedAt" = COALESCE("updatedAt", "createdAt")
WHERE "updatedAt" IS NULL;

ALTER TABLE "ReceiptAllocation"
  ALTER COLUMN "updatedAt" SET DEFAULT NOW();

