-- Company base currency code (ISO 4217)
ALTER TABLE "Company"
ADD COLUMN IF NOT EXISTS "currencyCode" TEXT NOT NULL DEFAULT 'PKR';

