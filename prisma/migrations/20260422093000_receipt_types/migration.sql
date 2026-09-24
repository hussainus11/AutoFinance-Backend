-- CreateEnum
CREATE TYPE "ReceiptType" AS ENUM ('NORMAL', 'DOWN_PAYMENT', 'COMMISSION', 'MANUAL');

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN "receiptType" "ReceiptType" NOT NULL DEFAULT 'NORMAL';

-- CreateIndex
CREATE INDEX "Receipt_contractId_createdAt_idx" ON "Receipt"("contractId", "createdAt");

