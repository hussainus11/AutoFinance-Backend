-- CreateEnum
CREATE TYPE "TaskQueueStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED', 'MODIFICATION_REQUIRED');

-- CreateTable
CREATE TABLE "TaskQueueRequest" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "status" "TaskQueueStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskQueueRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskQueueRequest_contractId_key" ON "TaskQueueRequest"("contractId");

-- CreateIndex
CREATE INDEX "TaskQueueRequest_status_idx" ON "TaskQueueRequest"("status");

-- CreateIndex
CREATE INDEX "TaskQueueRequest_createdAt_idx" ON "TaskQueueRequest"("createdAt");

-- AddForeignKey
ALTER TABLE "TaskQueueRequest" ADD CONSTRAINT "TaskQueueRequest_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
