-- Repair migration: add missing RecoveryStatus enum values (idempotent)
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

