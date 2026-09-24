-- Add flag to control date validation for chart rules.
ALTER TABLE "FinanceChart"
ADD COLUMN IF NOT EXISTS "validateChart" BOOLEAN NOT NULL DEFAULT TRUE;

