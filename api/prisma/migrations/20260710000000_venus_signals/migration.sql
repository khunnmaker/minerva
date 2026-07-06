-- Venus §7 remaining code signals: cross-sell gaps + big-ticket anniversary
-- (VENUS_BRIEF.md §7). ADDITIVE ONLY — two new nullable JSON columns on the existing
-- CustomerStats row, nothing else changes.

ALTER TABLE "CustomerStats" ADD COLUMN "crossSellGaps" JSONB;
ALTER TABLE "CustomerStats" ADD COLUMN "bigTicket" JSONB;
