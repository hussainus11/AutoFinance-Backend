-- Add multi-contact arrays on Company (phones/emails/addresses).
-- Keep existing single phone/email/addressLine fields for backward compatibility.

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "phones" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "emails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "addresses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

