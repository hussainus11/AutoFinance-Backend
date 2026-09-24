-- Repossession / Recovery workflow expansion

-- 1) Enums: VehicleStatus additions
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t WHERE t.typname = 'VehicleStatus') THEN
    -- enum exists via prisma migrations; nothing to do here
    NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t WHERE t.typname = 'VehicleStatus') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='VehicleStatus' AND e.enumlabel='REPOSSESSED') THEN
      ALTER TYPE "VehicleStatus" ADD VALUE 'REPOSSESSED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='VehicleStatus' AND e.enumlabel='DISPOSED') THEN
      ALTER TYPE "VehicleStatus" ADD VALUE 'DISPOSED';
    END IF;
  END IF;
END $$;

-- 2) Enums: RecoveryStatus additions (keep RESOLVED for back-compat)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t WHERE t.typname = 'RecoveryStatus') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='RecoveryStatus' AND e.enumlabel='REPO_REQUESTED') THEN
      ALTER TYPE "RecoveryStatus" ADD VALUE 'REPO_REQUESTED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='RecoveryStatus' AND e.enumlabel='REPO_APPROVED') THEN
      ALTER TYPE "RecoveryStatus" ADD VALUE 'REPO_APPROVED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='RecoveryStatus' AND e.enumlabel='REPOSSESSED') THEN
      ALTER TYPE "RecoveryStatus" ADD VALUE 'REPOSSESSED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='RecoveryStatus' AND e.enumlabel='DISPOSAL_REQUESTED') THEN
      ALTER TYPE "RecoveryStatus" ADD VALUE 'DISPOSAL_REQUESTED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='RecoveryStatus' AND e.enumlabel='DISPOSAL_APPROVED') THEN
      ALTER TYPE "RecoveryStatus" ADD VALUE 'DISPOSAL_APPROVED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='RecoveryStatus' AND e.enumlabel='DISPOSED') THEN
      ALTER TYPE "RecoveryStatus" ADD VALUE 'DISPOSED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='RecoveryStatus' AND e.enumlabel='SETTLED') THEN
      ALTER TYPE "RecoveryStatus" ADD VALUE 'SETTLED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='RecoveryStatus' AND e.enumlabel='CLOSED') THEN
      ALTER TYPE "RecoveryStatus" ADD VALUE 'CLOSED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='RecoveryStatus' AND e.enumlabel='CANCELLED') THEN
      ALTER TYPE "RecoveryStatus" ADD VALUE 'CANCELLED';
    END IF;
  END IF;
END $$;

-- 3) Enums: TaskQueueRequestType additions
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t WHERE t.typname = 'TaskQueueRequestType') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='TaskQueueRequestType' AND e.enumlabel='RECOVERY_REPOSSESS') THEN
      ALTER TYPE "TaskQueueRequestType" ADD VALUE 'RECOVERY_REPOSSESS';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='TaskQueueRequestType' AND e.enumlabel='RECOVERY_DISPOSE') THEN
      ALTER TYPE "TaskQueueRequestType" ADD VALUE 'RECOVERY_DISPOSE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='TaskQueueRequestType' AND e.enumlabel='RECOVERY_CLOSE') THEN
      ALTER TYPE "TaskQueueRequestType" ADD VALUE 'RECOVERY_CLOSE';
    END IF;
  END IF;
END $$;

-- 4) New enum: RecoveryDisposalMethod
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t WHERE t.typname = 'RecoveryDisposalMethod') THEN
    CREATE TYPE "RecoveryDisposalMethod" AS ENUM ('AUCTION','DIRECT_SALE','RETURN_TO_DEALER','OTHER');
  END IF;
END $$;

-- 5) Extend RecoveryCase
ALTER TABLE "RecoveryCase"
  ADD COLUMN IF NOT EXISTS "caseNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "assignedToUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "repoRequestedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "repoApprovedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "repoAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "repoLocation" TEXT,
  ADD COLUMN IF NOT EXISTS "repoOfficerName" TEXT,
  ADD COLUMN IF NOT EXISTS "repoNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "disposalMethod" "RecoveryDisposalMethod",
  ADD COLUMN IF NOT EXISTS "disposedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "salePrice" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "disposalBuyerName" TEXT,
  ADD COLUMN IF NOT EXISTS "disposalBuyerContact" TEXT,
  ADD COLUMN IF NOT EXISTS "disposalNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "recoveryFeesTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RecoveryCase_assignedToUserId_fkey') THEN
    ALTER TABLE "RecoveryCase"
    ADD CONSTRAINT "RecoveryCase_assignedToUserId_fkey"
    FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "RecoveryCase_status_openedAt_idx" ON "RecoveryCase"("status","openedAt");
CREATE INDEX IF NOT EXISTS "RecoveryCase_assignedToUserId_idx" ON "RecoveryCase"("assignedToUserId");

-- 6) New tables: RecoveryCaseEvent / RecoveryCaseAttachment / RecoveryFee
CREATE TABLE IF NOT EXISTS "RecoveryCaseEvent" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "caseId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "note" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "RecoveryCaseEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RecoveryCaseAttachment" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "caseId" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "fileName" TEXT,
  "mimeType" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "RecoveryCaseAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RecoveryFee" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "caseId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "RecoveryFee_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RecoveryCaseEvent_companyId_fkey') THEN
    ALTER TABLE "RecoveryCaseEvent"
    ADD CONSTRAINT "RecoveryCaseEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RecoveryCaseEvent_branchId_fkey') THEN
    ALTER TABLE "RecoveryCaseEvent"
    ADD CONSTRAINT "RecoveryCaseEvent_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RecoveryCaseEvent_caseId_fkey') THEN
    ALTER TABLE "RecoveryCaseEvent"
    ADD CONSTRAINT "RecoveryCaseEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RecoveryCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RecoveryCaseEvent_createdByUserId_fkey') THEN
    ALTER TABLE "RecoveryCaseEvent"
    ADD CONSTRAINT "RecoveryCaseEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RecoveryCaseAttachment_companyId_fkey') THEN
    ALTER TABLE "RecoveryCaseAttachment"
    ADD CONSTRAINT "RecoveryCaseAttachment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RecoveryCaseAttachment_branchId_fkey') THEN
    ALTER TABLE "RecoveryCaseAttachment"
    ADD CONSTRAINT "RecoveryCaseAttachment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RecoveryCaseAttachment_caseId_fkey') THEN
    ALTER TABLE "RecoveryCaseAttachment"
    ADD CONSTRAINT "RecoveryCaseAttachment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RecoveryCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RecoveryFee_companyId_fkey') THEN
    ALTER TABLE "RecoveryFee"
    ADD CONSTRAINT "RecoveryFee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RecoveryFee_branchId_fkey') THEN
    ALTER TABLE "RecoveryFee"
    ADD CONSTRAINT "RecoveryFee_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RecoveryFee_caseId_fkey') THEN
    ALTER TABLE "RecoveryFee"
    ADD CONSTRAINT "RecoveryFee_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RecoveryCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "RecoveryCaseEvent_caseId_createdAt_idx" ON "RecoveryCaseEvent"("caseId","createdAt");
CREATE INDEX IF NOT EXISTS "RecoveryCaseAttachment_caseId_createdAt_idx" ON "RecoveryCaseAttachment"("caseId","createdAt");
CREATE INDEX IF NOT EXISTS "RecoveryFee_caseId_createdAt_idx" ON "RecoveryFee"("caseId","createdAt");

-- 7) TaskQueueRequest: link to RecoveryCase
ALTER TABLE "TaskQueueRequest" ADD COLUMN IF NOT EXISTS "recoveryCaseId" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskQueueRequest_recoveryCaseId_fkey') THEN
    ALTER TABLE "TaskQueueRequest"
    ADD CONSTRAINT "TaskQueueRequest_recoveryCaseId_fkey"
    FOREIGN KEY ("recoveryCaseId") REFERENCES "RecoveryCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "TaskQueueRequest_recoveryCaseId_createdAt_idx" ON "TaskQueueRequest"("recoveryCaseId","createdAt");

