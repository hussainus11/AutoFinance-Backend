-- AlterTable
ALTER TABLE "Installment" ADD COLUMN "lateFeeAccrued" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "Installment" ADD COLUMN "lastLateFeeRunAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProcessRun" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "message" TEXT,
    "summaryJson" TEXT,

    CONSTRAINT "ProcessRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessRun_startedAt_idx" ON "ProcessRun"("startedAt");

-- CreateIndex
CREATE INDEX "Installment_contractId_status_idx" ON "Installment"("contractId", "status");
