-- Add CREATED status to existing enum
ALTER TYPE "QuotationStatus" ADD VALUE IF NOT EXISTS 'CREATED';

