-- Add audit fields to User (align with Prisma audit extension)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "createdByName" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "updatedByName" TEXT;

