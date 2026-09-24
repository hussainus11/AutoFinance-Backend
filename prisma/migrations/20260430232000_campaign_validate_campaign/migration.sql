-- Add flag to control date validation for campaigns.
ALTER TABLE "Campaign"
ADD COLUMN IF NOT EXISTS "validateCampaign" BOOLEAN NOT NULL DEFAULT TRUE;

