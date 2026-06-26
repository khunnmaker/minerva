-- AlterTable: mark a payment slip as forwarded to finance
ALTER TABLE "Message" ADD COLUMN "financeSentAt" TIMESTAMP(3);
