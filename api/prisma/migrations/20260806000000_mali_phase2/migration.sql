-- Mali Phase 2 escalation delivery audit fields and one-draft-per-question guard.
-- Additive only: existing Phase 1 rows remain valid.
ALTER TABLE "KnowledgeQuestion"
  ADD COLUMN "routedAt" TIMESTAMP(3),
  ADD COLUMN "answerDeliveredAt" TIMESTAMP(3),
  ADD COLUMN "distillationClaimedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "KnowledgeArticle_sourceQuestionId_key"
  ON "KnowledgeArticle"("sourceQuestionId");

CREATE INDEX "KnowledgeDepartment_answererAgentIds_idx"
  ON "KnowledgeDepartment" USING GIN ("answererAgentIds");

CREATE INDEX "KnowledgeQuestion_status_departmentId_askedAt_idx"
  ON "KnowledgeQuestion"("status", "departmentId", "askedAt");
