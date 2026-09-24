-- Backfill after OVERDUE enum value exists (separate transaction from ALTER TYPE)
UPDATE "Installment"
SET status = 'OVERDUE'::"InstallmentStatus"
WHERE "dueDate" < NOW() AND status IN ('PENDING', 'PARTIAL');

UPDATE "Contract" c
SET status = 'OVERDUE'::"ContractStatus"
WHERE c.status = 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM "Installment" i
    WHERE i."contractId" = c.id AND i.status = 'OVERDUE'::"InstallmentStatus"
  );
