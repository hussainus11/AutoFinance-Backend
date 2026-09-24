-- Add missing ContractStatus enum values (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'REPOSSESSED' AND enumtypid = '"ContractStatus"'::regtype) THEN
    ALTER TYPE "ContractStatus" ADD VALUE 'REPOSSESSED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'CLOSED' AND enumtypid = '"ContractStatus"'::regtype) THEN
    ALTER TYPE "ContractStatus" ADD VALUE 'CLOSED';
  END IF;
END $$;

