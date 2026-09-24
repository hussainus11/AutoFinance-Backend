-- Tenant roles directory (lightweight RBAC labels)
CREATE TABLE IF NOT EXISTS "Role" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "createdByName" TEXT,
  "updatedByUserId" TEXT,
  "updatedByName" TEXT,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Role_companyId_fkey'
  ) THEN
    ALTER TABLE "Role"
    ADD CONSTRAINT "Role_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Role_companyId_name_key" ON "Role"("companyId","name");
CREATE INDEX IF NOT EXISTS "Role_companyId_idx" ON "Role"("companyId");
CREATE INDEX IF NOT EXISTS "Role_isActive_idx" ON "Role"("isActive");

