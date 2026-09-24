-- CreateEnum
CREATE TYPE "FinanceChartType" AS ENUM ('DOWN_PAYMENT_MIN', 'INTEREST_RATE_APR', 'ORIGINATION_FEE', 'DOCUMENTATION_FEE', 'REGISTRATION_FEE', 'PROCESSING_FEE', 'TITLE_FEE', 'LATE_PAYMENT_FEE', 'PREPAYMENT_PENALTY', 'GAP_INSURANCE', 'EXTENDED_WARRANTY', 'DEALERSHIP_ADMIN_FEE', 'CREDIT_INSURANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "FinanceChartValueKind" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateTable
CREATE TABLE "FinanceChart" (
    "id" TEXT NOT NULL,
    "chartType" "FinanceChartType" NOT NULL,
    "label" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "valueKind" "FinanceChartValueKind" NOT NULL,
    "value" DECIMAL(14,4) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceChart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceChart_chartType_isActive_idx" ON "FinanceChart"("chartType", "isActive");

-- CreateIndex
CREATE INDEX "FinanceChart_startDate_endDate_idx" ON "FinanceChart"("startDate", "endDate");
