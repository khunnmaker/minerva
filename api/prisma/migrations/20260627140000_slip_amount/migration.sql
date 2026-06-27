-- AlterTable: the OCR-read slip amount (for the corrected-amount admin audit)
ALTER TABLE "Message" ADD COLUMN "slipAmount" TEXT;
