-- Add Urdu name to accounting accounts (idempotent)
ALTER TABLE "AccountingAccount"
  ADD COLUMN IF NOT EXISTS "nameUr" TEXT;

