-- CreateEnum
CREATE TYPE "ReceiptAllocationComponent" AS ENUM ('INSTALLMENT', 'PRINCIPAL', 'INTEREST', 'TAX', 'LATE_FEE');

-- AlterTable Installment (add component dues/paid)
ALTER TABLE "Installment"
ADD COLUMN "taxDue" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "principalPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "interestPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "taxPaid" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable ReceiptAllocation (track component applied)
ALTER TABLE "ReceiptAllocation"
ADD COLUMN "component" "ReceiptAllocationComponent" NOT NULL DEFAULT 'INSTALLMENT';

