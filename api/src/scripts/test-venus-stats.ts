// Regression test for the pure-computation pieces of the Venus analytics engine
// (api/src/venus/stats.ts): quintile scoring and the Thai-segment mapping rule. No test
// framework in this repo (see test-parse-oeson.ts precedent) — plain script, exits 1 on
// any failure. The DB-backed half of the engine (recomputeStats itself, which reads
// SaleDoc/SaleLine via Prisma) is exercised against a real hand-built dataset as part of
// the end-to-end verification on venus_test (not here — no DB fixture story exists yet in
// this repo for plain scripts).
//
//   npx tsx src/scripts/test-venus-stats.ts
import { segmentFor, quintileScores, bigTicketFor, crossSellGapsFor } from '../venus/stats.js';

let failed = 0;
function check(cond: boolean, label: string) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    console.log(`FAIL: ${label}`);
    failed++;
  }
}

// ─── quintileScores ───

// 10 customers, ascending values 1..10. Non-inverted: lowest values get score 1, highest
// get score 5, in even quintile buckets of 2 each.
{
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const scores = quintileScores(values, false);
  check(JSON.stringify(scores) === JSON.stringify([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]), `quintileScores ascending non-inverted (got ${JSON.stringify(scores)})`);
}

// Same values, inverted (Recency direction): lowest "days since last purchase" (best) gets
// the HIGHEST score.
{
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const scores = quintileScores(values, true);
  check(JSON.stringify(scores) === JSON.stringify([5, 5, 4, 4, 3, 3, 2, 2, 1, 1]), `quintileScores ascending inverted (got ${JSON.stringify(scores)})`);
}

// Order independence: scores follow the VALUE, not array position.
{
  const values = [10, 1, 5]; // customer A=10 (best), B=1 (worst), C=5 (mid)
  const scores = quintileScores(values, false);
  check(scores[1] < scores[2] && scores[2] < scores[0], `quintileScores respects value order regardless of array position (got ${JSON.stringify(scores)})`);
}

// Empty input.
check(quintileScores([], false).length === 0, 'quintileScores([]) returns empty array');

// Ties: identical values MUST get an identical score (no split across buckets). With a big
// low-value cluster (five 1s) they should all share one score.
{
  const values = [1, 1, 1, 1, 1, 2, 3, 4, 5, 6];
  const scores = quintileScores(values, false);
  const oneScores = new Set(values.map((v, i) => (v === 1 ? scores[i] : -1)).filter((x) => x !== -1));
  check(oneScores.size === 1, `quintileScores: all equal values share one score (F=1 got: ${[...oneScores]})`);
}

// ─── segmentFor ───

// Champions: high across the board.
check(segmentFor(5, 5, 5) === 'ลูกค้าชั้นดี', 'segmentFor(5,5,5) === ลูกค้าชั้นดี');
check(segmentFor(4, 4, 4) === 'ลูกค้าชั้นดี', 'segmentFor(4,4,4) === ลูกค้าชั้นดี (boundary >=4)');

// At-risk: was GENUINELY valuable (high F OR high M) but recency stretched (low R).
check(segmentFor(1, 5, 5) === 'เสี่ยงหาย', 'segmentFor(1,5,5) === เสี่ยงหาย (high F+M, R low)');
check(segmentFor(2, 4, 1) === 'เสี่ยงหาย', 'segmentFor(2,4,1) === เสี่ยงหาย (high F history alone)');
check(segmentFor(2, 1, 4) === 'เสี่ยงหาย', 'segmentFor(2,1,4) === เสี่ยงหาย (high M spend alone)');

// Lost: gone (low R) AND never high-value — a mid/low F+M customer who stopped is Lost,
// NOT At-Risk (the key correctness fix: a 1–2 time buyer must not pollute the at-risk list).
check(segmentFor(1, 1, 1) === 'หายไปแล้ว', 'segmentFor(1,1,1) === หายไปแล้ว');
check(segmentFor(2, 3, 3) === 'หายไปแล้ว', 'segmentFor(2,3,3) === หายไปแล้ว (mid F/M, not high history → Lost not At-Risk)');

// New: recent, but not enough history yet to call loyal.
check(segmentFor(5, 1, 1) === 'มาใหม่', 'segmentFor(5,1,1) === มาใหม่');
check(segmentFor(4, 2, 3) === 'มาใหม่', 'segmentFor(4,2,3) === มาใหม่ (boundary R>=4, F<=2)');

// Loyal: the steady middle — everything that doesn't hit another rule.
check(segmentFor(3, 3, 3) === 'ลูกค้าประจำ', 'segmentFor(3,3,3) === ลูกค้าประจำ');
check(segmentFor(3, 5, 5) === 'ลูกค้าประจำ', 'segmentFor(3,5,5) === ลูกค้าประจำ (frequent+big but mid recency: not champion, not at-risk)');

// ─── bigTicketFor (VENUS_BRIEF.md §6/§7 big-ticket anniversary) ───

const NOW = new Date('2026-07-06T00:00:00Z');
const THRESHOLD = 20000;
const MIN_MONTHS = 6;

// Bought once, above threshold, aged past the minimum -> signal.
{
  const purchaseDate = new Date('2025-10-01T00:00:00Z'); // ~9 months before NOW
  const hit = bigTicketFor([purchaseDate], 45000, NOW, THRESHOLD, MIN_MONTHS);
  check(hit !== null && hit.monthsAgo >= MIN_MONTHS, `bigTicketFor: one-off above-threshold purchase aged 9mo yields a signal (got ${JSON.stringify(hit)})`);
}

// Bought TWICE (even if above threshold) -> NOT a one-off -> no signal (it's a real reorder
// cycle candidate instead, handled by the reorder-cycle path, not this one).
{
  const hit = bigTicketFor(
    [new Date('2025-01-01T00:00:00Z'), new Date('2025-10-01T00:00:00Z')],
    45000,
    NOW,
    THRESHOLD,
    MIN_MONTHS,
  );
  check(hit === null, `bigTicketFor: bought twice yields NO signal even above threshold (got ${JSON.stringify(hit)})`);
}

// Bought once, but BELOW threshold -> not "big-ticket" -> no signal.
{
  const hit = bigTicketFor([new Date('2025-10-01T00:00:00Z')], 5000, NOW, THRESHOLD, MIN_MONTHS);
  check(hit === null, `bigTicketFor: below-threshold one-off purchase yields NO signal (got ${JSON.stringify(hit)})`);
}

// Bought once, above threshold, but TOO RECENT (< minMonths ago) -> no signal yet.
{
  const purchaseDate = new Date('2026-06-01T00:00:00Z'); // ~1 month before NOW
  const hit = bigTicketFor([purchaseDate], 45000, NOW, THRESHOLD, MIN_MONTHS);
  check(hit === null, `bigTicketFor: too-recent one-off purchase yields NO signal (got ${JSON.stringify(hit)})`);
}

// Boundary: exactly at minMonths (allowing float precision) should qualify.
{
  const purchaseDate = new Date(NOW.getTime() - MIN_MONTHS * 30.4375 * 86400000 - 86400000); // 1 day past boundary
  const hit = bigTicketFor([purchaseDate], 45000, NOW, THRESHOLD, MIN_MONTHS);
  check(hit !== null, `bigTicketFor: just past the minMonths boundary yields a signal (got ${JSON.stringify(hit)})`);
}

// ─── crossSellGapsFor (VENUS_BRIEF.md §7 cross-sell gap) ───

// Owns the anchor, has a positive-score link to an un-owned crossSku -> gap.
{
  const owned = new Set(['A1']);
  const links = [{ anchorSku: 'A1', crossSku: 'B1', score: 3 }];
  const gaps = crossSellGapsFor(owned, links);
  check(gaps.length === 1 && gaps[0].crossSku === 'B1', `crossSellGapsFor: owns anchor + un-owned scored cross -> 1 gap (got ${JSON.stringify(gaps)})`);
}

// Owns BOTH anchor and crossSku -> no gap (already has it, nothing to suggest).
{
  const owned = new Set(['A1', 'B1']);
  const links = [{ anchorSku: 'A1', crossSku: 'B1', score: 3 }];
  const gaps = crossSellGapsFor(owned, links);
  check(gaps.length === 0, `crossSellGapsFor: owns both anchor and cross -> NO gap (got ${JSON.stringify(gaps)})`);
}

// Does not own the anchor at all -> link is irrelevant -> no gap.
{
  const owned = new Set(['Z9']);
  const links = [{ anchorSku: 'A1', crossSku: 'B1', score: 3 }];
  const gaps = crossSellGapsFor(owned, links);
  check(gaps.length === 0, `crossSellGapsFor: does not own the anchor -> NO gap (got ${JSON.stringify(gaps)})`);
}

// Non-positive score (demoted/unlearned pairing) -> excluded even if otherwise a gap.
{
  const owned = new Set(['A1']);
  const links = [{ anchorSku: 'A1', crossSku: 'B1', score: 0 }, { anchorSku: 'A1', crossSku: 'B2', score: -3 }];
  const gaps = crossSellGapsFor(owned, links);
  check(gaps.length === 0, `crossSellGapsFor: score<=0 links excluded (got ${JSON.stringify(gaps)})`);
}

// Empty links (no CrossSellLink rows at all, e.g. venus_test) -> cleanly empty, no throw.
{
  const gaps = crossSellGapsFor(new Set(['A1']), []);
  check(gaps.length === 0, 'crossSellGapsFor: empty links array yields empty gaps (no throw)');
}

// Same crossSku reachable via two owned anchors -> de-duped, keeps the higher score.
{
  const owned = new Set(['A1', 'A2']);
  const links = [
    { anchorSku: 'A1', crossSku: 'B1', score: 2 },
    { anchorSku: 'A2', crossSku: 'B1', score: 5 },
  ];
  const gaps = crossSellGapsFor(owned, links);
  check(gaps.length === 1 && gaps[0].score === 5 && gaps[0].anchorSku === 'A2', `crossSellGapsFor: de-dupes by crossSku, keeps highest score (got ${JSON.stringify(gaps)})`);
}

// Cap respected: more qualifying gaps than the limit -> truncated to the limit, highest-score first.
{
  const owned = new Set(['A1']);
  const links = Array.from({ length: 10 }, (_, i) => ({ anchorSku: 'A1', crossSku: `B${i}`, score: i + 1 }));
  const gaps = crossSellGapsFor(owned, links, 3);
  check(gaps.length === 3 && gaps[0].score === 10, `crossSellGapsFor: capped to limit, sorted score desc (got ${JSON.stringify(gaps)})`);
}

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
} else {
  console.log('\nAll checks PASSED');
}
