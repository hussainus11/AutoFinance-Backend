-- Persist pricing snapshot fields so chart/campaign updates don't affect existing contracts/quotations.

ALTER TABLE "Contract"
ADD COLUMN IF NOT EXISTS "downPaymentAmount" DECIMAL(14,2),
ADD COLUMN IF NOT EXISTS "feesAmount" DECIMAL(14,2);

ALTER TABLE "Quotation"
ADD COLUMN IF NOT EXISTS "downPaymentAmount" DECIMAL(14,2),
ADD COLUMN IF NOT EXISTS "feesAmount" DECIMAL(14,2);

