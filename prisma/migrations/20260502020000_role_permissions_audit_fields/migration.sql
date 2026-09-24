-- Add audit fields to RolePermission (align with Prisma audit extension)
ALTER TABLE "RolePermission" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "RolePermission" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "RolePermission" ADD COLUMN IF NOT EXISTS "createdByName" TEXT;
ALTER TABLE "RolePermission" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;
ALTER TABLE "RolePermission" ADD COLUMN IF NOT EXISTS "updatedByName" TEXT;

