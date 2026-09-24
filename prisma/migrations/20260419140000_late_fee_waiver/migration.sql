-- CreateEnum
CREATE TYPE "WaiverValueKind" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateTable
CREATE TABLE "LateFeeWaiver" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "installmentId" TEXT NOT NULL,
    "valueKind" "WaiverValueKind" NOT NULL,
    "inputValue" DECIMAL(14,4) NOT NULL,
    "amountWaived" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LateFeeWaiver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LateFeeWaiver_contractId_createdAt_idx" ON "LateFeeWaiver"("contractId", "createdAt");

-- CreateIndex
CREATE INDEX "LateFeeWaiver_installmentId_idx" ON "LateFeeWaiver"("installmentId");

-- AddForeignKey
ALTER TABLE "LateFeeWaiver" ADD CONSTRAINT "LateFeeWaiver_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LateFeeWaiver" ADD CONSTRAINT "LateFeeWaiver_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "Installment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
