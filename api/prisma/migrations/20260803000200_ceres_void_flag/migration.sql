-- Ceres CEO-void + staff-flag feature (2026-07-21 owner directive). Purely additive:
-- one new table, no column changes. CeresPaymentRequest.voidedById/voidedAt/voidReason
-- already exist (added unused in 20260726000000_ceres_staff_requests) — this migration
-- just gives them a writer (POST /api/ceres/requests/:id/void, ceo-only).

-- CreateTable
CREATE TABLE "CeresFlag" (
  "id" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "flaggedById" TEXT,
  "flaggedByName" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedById" TEXT,
  "resolvedByName" TEXT NOT NULL DEFAULT '',
  "resolvedAt" TIMESTAMP(3),
  "resolutionNote" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "CeresFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CeresFlag_targetType_targetId_status_idx" ON "CeresFlag"("targetType", "targetId", "status");
CREATE INDEX "CeresFlag_status_createdAt_idx" ON "CeresFlag"("status", "createdAt");
CREATE INDEX "CeresFlag_flaggedById_idx" ON "CeresFlag"("flaggedById");
