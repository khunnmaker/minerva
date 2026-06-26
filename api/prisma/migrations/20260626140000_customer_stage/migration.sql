-- AlterTable: sales-pipeline stage + the AI's pending suggestion
ALTER TABLE "Customer" ADD COLUMN "stage" TEXT;
ALTER TABLE "Customer" ADD COLUMN "suggestedStage" TEXT;
