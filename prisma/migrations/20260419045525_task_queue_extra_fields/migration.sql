-- CreateEnum
CREATE TYPE "TaskQueuePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- AlterTable
ALTER TABLE "TaskQueueRequest" ADD COLUMN     "assignedToUserId" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "priority" "TaskQueuePriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "title" TEXT;

-- CreateIndex
CREATE INDEX "TaskQueueRequest_assignedToUserId_idx" ON "TaskQueueRequest"("assignedToUserId");

-- CreateIndex
CREATE INDEX "TaskQueueRequest_dueDate_idx" ON "TaskQueueRequest"("dueDate");

-- AddForeignKey
ALTER TABLE "TaskQueueRequest" ADD CONSTRAINT "TaskQueueRequest_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
