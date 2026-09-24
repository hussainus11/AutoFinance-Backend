-- Add trackable overpayment/advance on receipts.
ALTER TABLE "Receipt"
ADD COLUMN IF NOT EXISTS "unallocatedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

