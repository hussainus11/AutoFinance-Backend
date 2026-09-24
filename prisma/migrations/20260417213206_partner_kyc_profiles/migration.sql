-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'SEPARATED');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('EMPLOYED', 'SELF_EMPLOYED', 'UNEMPLOYED', 'RETIRED', 'STUDENT', 'OTHER');

-- CreateEnum
CREATE TYPE "PhoneType" AS ENUM ('MOBILE', 'HOME', 'WORK', 'FAX', 'WHATSAPP', 'OTHER');

-- CreateEnum
CREATE TYPE "EmailType" AS ENUM ('PERSONAL', 'WORK', 'OTHER');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('REGISTERED', 'MAILING', 'RESIDENTIAL', 'WORK', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE', 'PROOF_OF_ADDRESS', 'BANK_STATEMENT', 'PAYSLIP', 'TAX_RETURN', 'VEHICLE_REGISTRATION', 'INSURANCE', 'OTHER');

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "employerName" TEXT,
ADD COLUMN     "employmentStatus" "EmploymentStatus",
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "maritalStatus" "MaritalStatus",
ADD COLUMN     "middleName" TEXT,
ADD COLUMN     "monthlyIncome" DECIMAL(14,2),
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "relationshipToBorrower" TEXT,
ADD COLUMN     "salutation" TEXT;

-- CreateTable
CREATE TABLE "PartnerPhone" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "phoneType" "PhoneType" NOT NULL DEFAULT 'MOBILE',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,

    CONSTRAINT "PartnerPhone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerEmail" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailType" "EmailType" NOT NULL DEFAULT 'PERSONAL',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PartnerEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerAddress" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "addressType" "AddressType" NOT NULL DEFAULT 'RESIDENTIAL',
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT,
    "stateRegion" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PartnerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerDocument" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "title" TEXT,
    "fileName" TEXT,
    "fileUrl" TEXT,
    "mimeType" TEXT,
    "notes" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerPhone_partnerId_idx" ON "PartnerPhone"("partnerId");

-- CreateIndex
CREATE INDEX "PartnerEmail_partnerId_idx" ON "PartnerEmail"("partnerId");

-- CreateIndex
CREATE INDEX "PartnerAddress_partnerId_idx" ON "PartnerAddress"("partnerId");

-- CreateIndex
CREATE INDEX "PartnerDocument_partnerId_idx" ON "PartnerDocument"("partnerId");

-- AddForeignKey
ALTER TABLE "PartnerPhone" ADD CONSTRAINT "PartnerPhone_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerEmail" ADD CONSTRAINT "PartnerEmail_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerAddress" ADD CONSTRAINT "PartnerAddress_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerDocument" ADD CONSTRAINT "PartnerDocument_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill legacy single phone / email into child rows (one-time)
INSERT INTO "PartnerPhone" ("id", "partnerId", "phoneNumber", "phoneType", "isPrimary", "label")
SELECT gen_random_uuid()::text, "id", trim("phone"), 'MOBILE'::"PhoneType", true, NULL
FROM "Partner"
WHERE "phone" IS NOT NULL AND btrim("phone") <> '';

INSERT INTO "PartnerEmail" ("id", "partnerId", "email", "emailType", "isPrimary")
SELECT gen_random_uuid()::text, "id", trim("email"), 'PERSONAL'::"EmailType", true
FROM "Partner"
WHERE "email" IS NOT NULL AND btrim("email") <> '';
