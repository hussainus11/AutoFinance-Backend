-- Drop unique constraint so multiple task requests per contract are allowed
DROP INDEX IF EXISTS "TaskQueueRequest_contractId_key";

-- Add request type + optional restructureRequestId
CREATE TYPE "TaskQueueRequestType" AS ENUM ('CONTRACT_CREATE', 'CONTRACT_EDIT', 'CONTRACT_RESTRUCTURE');

ALTER TABLE "TaskQueueRequest"
  ADD COLUMN "requestType" "TaskQueueRequestType" NOT NULL DEFAULT 'CONTRACT_CREATE',
  ADD COLUMN "restructureRequestId" TEXT;

-- Helpful index for listing per contract
CREATE INDEX "TaskQueueRequest_contractId_createdAt_idx" ON "TaskQueueRequest"("contractId", "createdAt");

