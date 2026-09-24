-- CreateEnum
CREATE TYPE "RestructureRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "RestructureRequest" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "pivotInstallmentId" TEXT NOT NULL,
  "pivotSequence" INTEGER NOT NULL,
  "status" "RestructureRequestStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "note" TEXT,

  CONSTRAINT "RestructureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallmentHistory" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "restructureRequestId" TEXT,
  "sequence" INTEGER NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "principalDue" DECIMAL(14,2) NOT NULL,
  "interestDue" DECIMAL(14,2) NOT NULL,
  "taxDue" DECIMAL(14,2) NOT NULL,
  "totalDue" DECIMAL(14,2) NOT NULL,
  "paidAmount" DECIMAL(14,2) NOT NULL,
  "principalPaid" DECIMAL(14,2) NOT NULL,
  "interestPaid" DECIMAL(14,2) NOT NULL,
  "taxPaid" DECIMAL(14,2) NOT NULL,
  "status" "InstallmentStatus" NOT NULL,
  "lateFeeAccrued" DECIMAL(14,2) NOT NULL,
  "lastLateFeeRunAt" TIMESTAMP(3),
  "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InstallmentHistory_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "RestructureRequest_contractId_createdAt_idx" ON "RestructureRequest"("contractId", "createdAt");
CREATE INDEX "RestructureRequest_status_createdAt_idx" ON "RestructureRequest"("status", "createdAt");
CREATE INDEX "InstallmentHistory_contractId_movedAt_idx" ON "InstallmentHistory"("contractId", "movedAt");
CREATE INDEX "InstallmentHistory_restructureRequestId_idx" ON "InstallmentHistory"("restructureRequestId");

-- FKs
ALTER TABLE "RestructureRequest"
  ADD CONSTRAINT "RestructureRequest_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InstallmentHistory"
  ADD CONSTRAINT "InstallmentHistory_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InstallmentHistory"
  ADD CONSTRAINT "InstallmentHistory_restructureRequestId_fkey"
  FOREIGN KEY ("restructureRequestId") REFERENCES "RestructureRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

