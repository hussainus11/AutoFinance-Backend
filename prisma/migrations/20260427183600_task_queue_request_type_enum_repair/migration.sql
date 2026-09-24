-- Repair migration: add missing TaskQueueRequestType enum values (idempotent)
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

