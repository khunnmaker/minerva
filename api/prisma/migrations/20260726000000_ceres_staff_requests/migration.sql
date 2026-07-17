-- Ceres revamp Phase 1: additive request, media, and cash-ledger foundation.
-- Existing payment requests remain workflowVersion=1 / legacy_payment and retain
-- their original status workflow. No existing rows are deleted or reclassified.

-- AlterTable
ALTER TABLE "CeresPaymentRequest"
ADD COLUMN "workflowVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "requestType" TEXT NOT NULL DEFAULT 'legacy_payment',
ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN "fulfillmentStatus" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN "requesterPartyId" TEXT,
ADD COLUMN "requestPhotoUploadId" TEXT,
ADD COLUMN "requestPhotoSha" TEXT NOT NULL DEFAULT '',
ADD COLUMN "ocrAmount" TEXT NOT NULL DEFAULT '',
ADD COLUMN "ocrVendor" TEXT NOT NULL DEFAULT '',
ADD COLUMN "ocrDate" TEXT NOT NULL DEFAULT '',
ADD COLUMN "aiScreenStatus" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN "neeDecidedById" TEXT,
ADD COLUMN "neeDecidedByName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "neeDecidedAt" TIMESTAMP(3),
ADD COLUMN "neeDecisionNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN "rowVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "updatedAt" TIMESTAMP(3),
ADD COLUMN "voidedById" TEXT,
ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "voidReason" TEXT NOT NULL DEFAULT '';

UPDATE "CeresPaymentRequest" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "CeresPaymentRequest" ALTER COLUMN "updatedAt" SET NOT NULL;

-- AlterTable
ALTER TABLE "CashMovement"
ADD COLUMN "direction" TEXT,
ADD COLUMN "requestId" TEXT,
ADD COLUMN "requestMoneyEventId" TEXT,
ADD COLUMN "reversesMovementId" TEXT;

UPDATE "CashMovement"
SET "direction" = CASE
  WHEN "type" = 'advance' THEN 'out'
  WHEN "type" IN ('deposit', 'topup', 'refund') THEN 'in'
  ELSE NULL
END
WHERE "direction" IS NULL;

-- AlterTable
ALTER TABLE "CeresExpense"
ADD COLUMN "advanceRequestId" TEXT,
ADD COLUMN "fundingLane" TEXT NOT NULL DEFAULT 'cash';

-- CreateTable
CREATE TABLE "CeresMedia" (
  "id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "uploadedById" TEXT,
  "uploadedByName" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CeresMedia_pkey" PRIMARY KEY ("id")
);

-- Existing referenced receipt files become registered legacy media. DISTINCT ON
-- keeps this safe even if historical duplicate submissions reused an upload id.
INSERT INTO "CeresMedia" ("id", "purpose", "sha256", "uploadedById", "uploadedByName", "createdAt")
SELECT DISTINCT ON ("receiptUploadId")
  "receiptUploadId", 'legacy_receipt', "receiptSha", "enteredById", "enteredByName", "createdAt"
FROM "CeresExpense"
WHERE "receiptUploadId" IS NOT NULL
ORDER BY "receiptUploadId", "createdAt" ASC
ON CONFLICT ("id") DO NOTHING;

-- CreateTable
CREATE TABLE "CeresRequestEvent" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "actorId" TEXT,
  "actorName" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "payload" JSONB NOT NULL,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CeresRequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CeresRequestMoneyEvent" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "lane" TEXT NOT NULL,
  "amount" TEXT NOT NULL,
  "transferSlipUploadId" TEXT,
  "purchaseReceiptUploadId" TEXT,
  "cashMovementId" TEXT,
  "reversesEventId" TEXT,
  "createdById" TEXT,
  "createdByName" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idempotencyKey" TEXT,
  CONSTRAINT "CeresRequestMoneyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CeresSettlementRequestLine" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "moneyEventId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "partyName" TEXT NOT NULL DEFAULT '',
  "amount" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CeresSettlementRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CeresPaymentRequest_workflowVersion_approvalStatus_createdAt_idx" ON "CeresPaymentRequest"("workflowVersion", "approvalStatus", "createdAt");
CREATE INDEX "CeresPaymentRequest_requestedById_createdAt_idx" ON "CeresPaymentRequest"("requestedById", "createdAt");
CREATE INDEX "CeresPaymentRequest_requestType_fulfillmentStatus_idx" ON "CeresPaymentRequest"("requestType", "fulfillmentStatus");
CREATE INDEX "CeresPaymentRequest_requesterPartyId_idx" ON "CeresPaymentRequest"("requesterPartyId");
CREATE INDEX "CeresPaymentRequest_requestPhotoSha_idx" ON "CeresPaymentRequest"("requestPhotoSha");
CREATE INDEX "CashMovement_requestId_idx" ON "CashMovement"("requestId");
CREATE INDEX "CashMovement_requestMoneyEventId_idx" ON "CashMovement"("requestMoneyEventId");
CREATE INDEX "CashMovement_reversesMovementId_idx" ON "CashMovement"("reversesMovementId");
CREATE INDEX "CeresExpense_advanceRequestId_idx" ON "CeresExpense"("advanceRequestId");
CREATE INDEX "CeresMedia_uploadedById_createdAt_idx" ON "CeresMedia"("uploadedById", "createdAt");
CREATE INDEX "CeresMedia_sha256_idx" ON "CeresMedia"("sha256");
CREATE UNIQUE INDEX "CeresRequestEvent_idempotencyKey_key" ON "CeresRequestEvent"("idempotencyKey");
CREATE INDEX "CeresRequestEvent_requestId_createdAt_idx" ON "CeresRequestEvent"("requestId", "createdAt");
CREATE INDEX "CeresRequestEvent_kind_idx" ON "CeresRequestEvent"("kind");
CREATE UNIQUE INDEX "CeresRequestMoneyEvent_idempotencyKey_key" ON "CeresRequestMoneyEvent"("idempotencyKey");
CREATE INDEX "CeresRequestMoneyEvent_requestId_createdAt_idx" ON "CeresRequestMoneyEvent"("requestId", "createdAt");
CREATE INDEX "CeresRequestMoneyEvent_cashMovementId_idx" ON "CeresRequestMoneyEvent"("cashMovementId");
CREATE INDEX "CeresRequestMoneyEvent_reversesEventId_idx" ON "CeresRequestMoneyEvent"("reversesEventId");
CREATE UNIQUE INDEX "CeresSettlementRequestLine_moneyEventId_key" ON "CeresSettlementRequestLine"("moneyEventId");
CREATE INDEX "CeresSettlementRequestLine_settlementId_idx" ON "CeresSettlementRequestLine"("settlementId");
CREATE INDEX "CeresSettlementRequestLine_requestId_idx" ON "CeresSettlementRequestLine"("requestId");

-- AddForeignKey
ALTER TABLE "CeresSettlementRequestLine"
ADD CONSTRAINT "CeresSettlementRequestLine_settlementId_fkey"
FOREIGN KEY ("settlementId") REFERENCES "CeresSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
