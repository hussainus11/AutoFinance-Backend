-- Add audit columns to CampaignVehicle / CampaignChart (idempotent)

ALTER TABLE "CampaignVehicle"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "createdByName" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedByName" TEXT;

UPDATE "CampaignVehicle"
SET "updatedAt" = COALESCE("updatedAt", "createdAt")
WHERE "updatedAt" IS NULL;

ALTER TABLE "CampaignVehicle"
  ALTER COLUMN "updatedAt" SET DEFAULT NOW();

ALTER TABLE "CampaignChart"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "createdByName" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedByName" TEXT;

UPDATE "CampaignChart"
SET "updatedAt" = COALESCE("updatedAt", "createdAt")
WHERE "updatedAt" IS NULL;

ALTER TABLE "CampaignChart"
  ALTER COLUMN "updatedAt" SET DEFAULT NOW();

