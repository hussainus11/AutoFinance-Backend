-- Add audit columns to Installment (idempotent)

ALTER TABLE "Installment"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "createdByName" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedByName" TEXT;

UPDATE "Installment"
SET "createdAt" = COALESCE("createdAt", NOW())
WHERE "createdAt" IS NULL;

UPDATE "Installment"
SET "updatedAt" = COALESCE("updatedAt", "createdAt")
WHERE "updatedAt" IS NULL;

ALTER TABLE "Installment"
  ALTER COLUMN "createdAt" SET DEFAULT NOW();

ALTER TABLE "Installment"
  ALTER COLUMN "updatedAt" SET DEFAULT NOW();

