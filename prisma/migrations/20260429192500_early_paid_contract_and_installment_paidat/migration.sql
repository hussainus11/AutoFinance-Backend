-- Add missing ContractStatus enum value (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'EARLY_PAID' AND enumtypid = '"ContractStatus"'::regtype) THEN
    ALTER TYPE "ContractStatus" ADD VALUE 'EARLY_PAID';
  END IF;
END $$;

-- Installment.paidAt for early-paid detection (idempotent)
ALTER TABLE "Installment" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMPTZ;

