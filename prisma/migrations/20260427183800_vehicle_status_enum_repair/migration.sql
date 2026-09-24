-- Repair migration: add missing VehicleStatus enum values (idempotent)
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

