-- AlterEnum: ContractStatus.OVERDUE (must be committed before use — separate migration for backfill)
ALTER TYPE "ContractStatus" ADD VALUE 'OVERDUE';
