-- Add tenant scoping for Settings tables (SystemConfig, AuditLog)

-- SystemConfig: add columns
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

-- Backfill existing rows
UPDATE "SystemConfig"
SET "companyId" = '00000000-0000-0000-0000-000000000001'
WHERE "companyId" IS NULL;

ALTER TABLE "SystemConfig" ALTER COLUMN "companyId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "SystemConfig_branchId_idx" ON "SystemConfig"("branchId");

-- Rebuild primary key to (companyId, key) if needed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '"SystemConfig"'::regclass
      AND contype = 'p'
      AND conname = 'SystemConfig_pkey'
  ) THEN
    ALTER TABLE "SystemConfig" DROP CONSTRAINT "SystemConfig_pkey";
  END IF;
  ALTER TABLE "SystemConfig" ADD CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("companyId", "key");
END $$;

-- FK to Company (optional but recommended)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SystemConfig_companyId_fkey') THEN
    ALTER TABLE "SystemConfig"
    ADD CONSTRAINT "SystemConfig_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AuditLog: add columns
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

-- Backfill existing rows to default tenant
UPDATE "AuditLog"
SET "companyId" = '00000000-0000-0000-0000-000000000001'
WHERE "companyId" IS NULL;

CREATE INDEX IF NOT EXISTS "AuditLog_companyId_idx" ON "AuditLog"("companyId");
CREATE INDEX IF NOT EXISTS "AuditLog_branchId_idx" ON "AuditLog"("branchId");

-- Optional FK (SetNull to keep historical logs if company deleted)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_companyId_fkey') THEN
    ALTER TABLE "AuditLog"
    ADD CONSTRAINT "AuditLog_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_branchId_fkey') THEN
    ALTER TABLE "AuditLog"
    ADD CONSTRAINT "AuditLog_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

