-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'ISSUED', 'EXPIRED', 'CONVERTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "quotationNumber" TEXT NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "buyerId" TEXT NOT NULL,
    "agentId" TEXT,
    "campaignId" TEXT,
    "principalAmount" DECIMAL(14,2) NOT NULL,
    "interestRateApr" DECIMAL(8,4) NOT NULL,
    "tenureMonths" INTEGER NOT NULL,
    "installmentType" "InstallmentType" NOT NULL DEFAULT 'MONTHLY',
    "startDate" TIMESTAMP(3),
    "balloonAmount" DECIMAL(14,2),
    "convertedContractId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationVehicle" (
    "quotationId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "salePrice" DECIMAL(14,2) NOT NULL,
    CONSTRAINT "QuotationVehicle_pkey" PRIMARY KEY ("quotationId","vehicleId")
);

-- CreateTable
CREATE TABLE "QuotationGuarantor" (
    "quotationId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    CONSTRAINT "QuotationGuarantor_pkey" PRIMARY KEY ("quotationId","partnerId")
);

-- CreateTable
CREATE TABLE "QuotationInstallment" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "principalDue" DECIMAL(14,2) NOT NULL,
    "interestDue" DECIMAL(14,2) NOT NULL,
    "taxDue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDue" DECIMAL(14,2) NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    CONSTRAINT "QuotationInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_quotationNumber_key" ON "Quotation"("quotationNumber");

-- CreateIndex
CREATE INDEX "Quotation_status_createdAt_idx" ON "Quotation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Quotation_buyerId_createdAt_idx" ON "Quotation"("buyerId", "createdAt");

-- CreateIndex
CREATE INDEX "QuotationInstallment_quotationId_sequence_idx" ON "QuotationInstallment"("quotationId", "sequence");

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_convertedContractId_fkey" FOREIGN KEY ("convertedContractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationVehicle" ADD CONSTRAINT "QuotationVehicle_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationVehicle" ADD CONSTRAINT "QuotationVehicle_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationGuarantor" ADD CONSTRAINT "QuotationGuarantor_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationGuarantor" ADD CONSTRAINT "QuotationGuarantor_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationInstallment" ADD CONSTRAINT "QuotationInstallment_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

