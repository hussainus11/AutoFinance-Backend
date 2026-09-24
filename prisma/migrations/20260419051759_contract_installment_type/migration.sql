-- CreateEnum
CREATE TYPE "InstallmentType" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'YEARLY');

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "installmentType" "InstallmentType" NOT NULL DEFAULT 'MONTHLY';
