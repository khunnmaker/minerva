-- Candidate product SKUs (with photos) offered to staff when the match is uncertain.
ALTER TABLE "Draft" ADD COLUMN "candidateSkus" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
