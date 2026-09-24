-- Document templates (tenant scoped)
CREATE TABLE IF NOT EXISTS "DocumentTemplate" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "key" TEXT NOT NULL,
  "lang" TEXT NOT NULL DEFAULT 'en',
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DocumentTemplate_companyId_fkey'
  ) THEN
    ALTER TABLE "DocumentTemplate"
    ADD CONSTRAINT "DocumentTemplate_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DocumentTemplate_branchId_fkey'
  ) THEN
    ALTER TABLE "DocumentTemplate"
    ADD CONSTRAINT "DocumentTemplate_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentTemplate_companyId_key_lang_key"
ON "DocumentTemplate"("companyId","key","lang");

CREATE INDEX IF NOT EXISTS "DocumentTemplate_companyId_idx" ON "DocumentTemplate"("companyId");
CREATE INDEX IF NOT EXISTS "DocumentTemplate_branchId_idx" ON "DocumentTemplate"("branchId");
CREATE INDEX IF NOT EXISTS "DocumentTemplate_key_idx" ON "DocumentTemplate"("key");

