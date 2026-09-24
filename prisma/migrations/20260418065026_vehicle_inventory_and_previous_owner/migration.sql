/*
  Warnings:

  - You are about to drop the column `condition` on the `Vehicle` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "VehicleCondition" AS ENUM ('NEW', 'USED', 'CERTIFIED_PRE_OWNED', 'DEMO', 'OTHER');

-- AlterEnum
ALTER TYPE "PartnerType" ADD VALUE 'PREVIOUS_OWNER';

-- AlterTable
ALTER TABLE "Vehicle" DROP COLUMN "condition",
ADD COLUMN     "bodyStyle" TEXT,
ADD COLUMN     "doors" INTEGER,
ADD COLUMN     "drivetrain" TEXT,
ADD COLUMN     "engineDescription" TEXT,
ADD COLUMN     "exteriorColor" TEXT,
ADD COLUMN     "fuelType" TEXT,
ADD COLUMN     "interiorColor" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "odometerKm" INTEGER,
ADD COLUMN     "previousOwnerId" TEXT,
ADD COLUMN     "purchaseDate" TIMESTAMP(3),
ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "registrationRegion" TEXT,
ADD COLUMN     "seats" INTEGER,
ADD COLUMN     "stockNumber" TEXT,
ADD COLUMN     "transmission" TEXT,
ADD COLUMN     "vehicleCondition" "VehicleCondition";

-- CreateTable
CREATE TABLE "VehicleImage" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleImage_vehicleId_idx" ON "VehicleImage"("vehicleId");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_previousOwnerId_fkey" FOREIGN KEY ("previousOwnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleImage" ADD CONSTRAINT "VehicleImage_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
