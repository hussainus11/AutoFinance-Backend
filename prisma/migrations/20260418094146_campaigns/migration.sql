-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "campaignId" TEXT;

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "allowChartOverride" BOOLEAN NOT NULL DEFAULT false,
    "allowInstallmentRestructure" BOOLEAN NOT NULL DEFAULT false,
    "allowBackdatedContracts" BOOLEAN NOT NULL DEFAULT false,
    "tenureMonthsOptions" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignVehicle" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignChart" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "chartId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignChart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_code_key" ON "Campaign"("code");

-- CreateIndex
CREATE INDEX "Campaign_isActive_startDate_endDate_idx" ON "Campaign"("isActive", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "CampaignVehicle_campaignId_idx" ON "CampaignVehicle"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignVehicle_vehicleId_idx" ON "CampaignVehicle"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignVehicle_campaignId_vehicleId_key" ON "CampaignVehicle"("campaignId", "vehicleId");

-- CreateIndex
CREATE INDEX "CampaignChart_campaignId_idx" ON "CampaignChart"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignChart_chartId_idx" ON "CampaignChart"("chartId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignChart_campaignId_chartId_key" ON "CampaignChart"("campaignId", "chartId");

-- AddForeignKey
ALTER TABLE "CampaignVehicle" ADD CONSTRAINT "CampaignVehicle_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignVehicle" ADD CONSTRAINT "CampaignVehicle_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignChart" ADD CONSTRAINT "CampaignChart_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignChart" ADD CONSTRAINT "CampaignChart_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "FinanceChart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
