import { Prisma, type PrismaClient } from '@prisma/client';

// Venus analytics engine (VENUS_BRIEF.md §6): RFM scores + Thai segments, 90d trend, and
// per-product reorder cycles. Pure code, no AI, recomputed on-demand (POST
// /api/venus/recompute) or via the runnable script (venus-recompute-stats.ts) — intended
// to also run nightly once a scheduler is wired up. Reads non-void SaleDoc/SaleLine only
// (void docs are cancelled orders — they must never count as real purchase behavior).
//
// One CustomerStats row per customer, fully OVERWRITTEN each run (derived data, not
// append-only money — see the model comment in schema.prisma). Customers with zero
// non-void sales in the window are left with no row (nothing to compute yet) rather than
// a row full of nulls/zeros that could be misread as "definitely zero activity".

// ─── Configurable thresholds (env-overridable, documented defaults from the brief) ───

// RFM window: how far back "recent" purchase history counts. Brief: 365d.
export const RFM_WINDOW_DAYS = Number(process.env.VENUS_RFM_WINDOW_DAYS ?? 365);
// Trend windows: last N days vs the N days before that. Brief: 90d each.
export const TREND_WINDOW_DAYS = Number(process.env.VENUS_TREND_WINDOW_DAYS ?? 90);
// Reorder-due multiplier: flag when today - lastPurchase > multiplier * median gap. Brief: 1.25.
export const REORDER_DUE_MULTIPLIER = Number(process.env.VENUS_REORDER_DUE_MULTIPLIER ?? 1.25);
// Minimum purchases of a SKU (per customer) before a reorder cycle is computed at all. Brief: >=3.
export const REORDER_MIN_PURCHASES = Number(process.env.VENUS_REORDER_MIN_PURCHASES ?? 3);
// Equipment heuristic: a SKU bought exactly once by a customer, above this unit price, is
// treated as a one-off big-ticket purchase (excluded from reorder cycles) rather than a
// consumable that just hasn't repeated yet. Brief: "configurable threshold, e.g. 20000".
export const EQUIPMENT_PRICE_THRESHOLD = Number(process.env.VENUS_EQUIPMENT_PRICE_THRESHOLD ?? 20000);
// Big-ticket anniversary: how many months must have passed since the one-off equipment
// purchase before it's worth a service/upgrade nudge (too-recent purchases aren't due for
// anything yet). Same items as the reorder-cycle EQUIPMENT_PRICE_THRESHOLD exclusion —
// this just adds a positive signal once they've aged (VENUS_BRIEF.md §7).
export const BIGTICKET_MIN_MONTHS = Number(process.env.VENUS_BIGTICKET_MIN_MONTHS ?? 6);
// Cross-sell gap cap: how many gap suggestions to keep per customer (ranked by score desc) —
// a well-connected anchor SKU could have many linked crossSkus; keep the row small and only
// the most-confident few (mirrors MAX_REORDER items pattern in cards.ts).
export const CROSSSELL_GAP_LIMIT = Number(process.env.VENUS_CROSSSELL_GAP_LIMIT ?? 5);

// ─── Thai segment mapping (explicit rule, see brief §6) ───
//
// RFM quintile scores (1=worst, 5=best) are computed independently for R, F, M by ranking
// all customers with at least one non-void purchase in the window and splitting into 5
// equal-ish buckets (quintiles). Note: for Recency, a SMALLER "days since last purchase"
// is BETTER, so R is scored inverted (most-recent customers get R=5).
//
// Segment rule (checked in this order — first match wins):
//   1. ลูกค้าชั้นดี  (Champions)  — R>=4 AND F>=4 AND M>=4: buys often, recently, big spend.
//   2. เสี่ยงหาย    (At-Risk)     — R<=2 AND (F>=4 OR M>=4): was GENUINELY valuable (high
//                                    frequency OR high spend history) but recency has
//                                    stretched — the "quietly fading" customer worth saving
//                                    (brief: "high F/M history, R stretching"). Requires real
//                                    history (top-quintile F or M), NOT a mid-tier score — a
//                                    customer who only ever bought once or twice is Lost, not
//                                    At-Risk, no matter how the quintiles fall.
//   3. หายไปแล้ว    (Lost)        — R<=2 and not At-Risk: long gone AND never high-value.
//   4. มาใหม่       (New)         — R>=4 AND F<=2: few purchases so far, but recent — too
//                                    early to call loyal or lost.
//   5. ลูกค้าประจำ  (Loyal)       — everything else: steady, unremarkable middle.
export type Segment = 'ลูกค้าชั้นดี' | 'ลูกค้าประจำ' | 'มาใหม่' | 'เสี่ยงหาย' | 'หายไปแล้ว';

export function segmentFor(rScore: number, fScore: number, mScore: number): Segment {
  if (rScore >= 4 && fScore >= 4 && mScore >= 4) return 'ลูกค้าชั้นดี';
  if (rScore <= 2 && (fScore >= 4 || mScore >= 4)) return 'เสี่ยงหาย';
  if (rScore <= 2) return 'หายไปแล้ว';
  if (rScore >= 4 && fScore <= 2) return 'มาใหม่';
  return 'ลูกค้าประจำ';
}

// Quintile scoring: score ascending values into 1..5 across the whole customer base.
// TIE-AWARE: every customer with the SAME value gets the SAME score — ties must never be
// split across score buckets, or two customers with identical frequency/recency/spend could
// land in different segments (with a low-frequency base, e.g. hundreds of customers all at
// F=1, positional bucketing would arbitrarily scatter them across scores 1–3). Each tie
// group takes the bucket of its FIRST (lowest) rank; for all-distinct values this reduces to
// a plain positional quintile. `invert` flips direction for Recency (smaller day-count = better).
export function quintileScores(values: number[], invert: boolean): number[] {
  const n = values.length;
  if (n === 0) return [];
  const order = values
    .map((v, i) => ({ v, i }))
    .sort((a, b) => a.v - b.v);
  const scores = new Array<number>(n);
  let k = 0;
  while (k < n) {
    let j = k;
    while (j < n && order[j].v === order[k].v) j++; // [k, j) is one tie group (equal values)
    const bucket = Math.min(4, Math.floor((k / n) * 5));
    const score = invert ? 5 - bucket : bucket + 1;
    for (let t = k; t < j; t++) scores[order[t].i] = score;
    k = j;
  }
  return scores;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function monthsBetween(a: Date, b: Date): number {
  return daysBetween(a, b) / 30.4375; // average month length, matches "monthsAgo" framing (not calendar months)
}

// Pure detector for the big-ticket anniversary signal (VENUS_BRIEF.md §6/§7): given ONE
// SKU's full purchase history + its max unit price, decide whether it's a one-off big-ticket
// item aged enough to be worth a service/upgrade nudge. Same equipment definition used to
// EXCLUDE these SKUs from reorder cycles (bought exactly once, above the price threshold) —
// this is the positive counterpart. Exported standalone (no DB) so it's directly unit-testable.
export function bigTicketFor(
  dates: Date[],
  maxUnitPrice: number,
  now: Date,
  priceThreshold: number = EQUIPMENT_PRICE_THRESHOLD,
  minMonths: number = BIGTICKET_MIN_MONTHS,
): { lastPurchase: Date; monthsAgo: number } | null {
  if (dates.length !== 1) return null; // bought twice+ -> a real reorder cycle, not one-off equipment
  if (!(maxUnitPrice > priceThreshold)) return null; // below threshold -> not "big-ticket"
  const lastPurchase = dates[0];
  const monthsAgo = monthsBetween(now, lastPurchase);
  if (monthsAgo < minMonths) return null; // too recent to nudge yet
  return { lastPurchase, monthsAgo };
}

// Pure picker for cross-sell gaps (VENUS_BRIEF.md §7): given the SKUs a customer already
// owns and the full set of CrossSellLink rows (anchorSku -> crossSku, score), return the
// scored links whose anchor the customer owns AND whose crossSku they do NOT own — ranked by
// score desc, capped. Positive-score links only (score<=0 pairings are demoted/unlearned
// pairings per crossSell.ts's DEMOTE_AT convention, not something worth suggesting). Exported
// standalone (no DB, no Product lookup) so the ranking/ownership logic is directly
// unit-testable; name resolution happens separately where the Product catalog is available.
export interface CrossSellLinkRow {
  anchorSku: string;
  crossSku: string;
  score: number;
}
export function crossSellGapsFor(
  ownedSkus: Set<string>,
  links: CrossSellLinkRow[],
  limit: number = CROSSSELL_GAP_LIMIT,
): { crossSku: string; anchorSku: string; score: number }[] {
  const gaps = links
    .filter((l) => l.score > 0 && ownedSkus.has(l.anchorSku) && !ownedSkus.has(l.crossSku))
    .sort((a, b) => b.score - a.score);
  // De-dupe by crossSku (a customer can own multiple anchors linked to the same gap) — keep
  // the highest-scoring anchor pairing per gap.
  const seen = new Set<string>();
  const out: { crossSku: string; anchorSku: string; score: number }[] = [];
  for (const g of gaps) {
    if (seen.has(g.crossSku)) continue;
    seen.add(g.crossSku);
    out.push({ crossSku: g.crossSku, anchorSku: g.anchorSku, score: g.score });
    if (out.length >= limit) break;
  }
  return out;
}

function parseMoney(s: string | null | undefined): number {
  if (!s) return 0;
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

export interface ReorderDueItem {
  sku: string;
  name: string | null; // product name as printed on the report (for display)
  lastPurchase: string; // ISO date
  medianGapDays: number;
  dueSinceDays: number; // how many days past the due point (today - (lastPurchase + multiplier*median))
  purchaseCount: number;
}

// Cross-sell gap (VENUS_BRIEF.md §7): a CrossSellLink pairing where the customer owns the
// anchorSku but has never bought the crossSku, ranked by score desc.
export interface CrossSellGapItem {
  crossSku: string;
  name: string | null; // Product.nameTh/nameEn, or null if not in the catalog
  anchorSku: string; // the SKU the customer already owns that this gap was learned from
  score: number;
}

// Big-ticket anniversary (VENUS_BRIEF.md §6/§7): a one-off equipment SKU (bought exactly
// once, above EQUIPMENT_PRICE_THRESHOLD) aged past BIGTICKET_MIN_MONTHS — worth a
// service/upgrade nudge.
export interface BigTicketItem {
  sku: string;
  name: string | null;
  unitPrice: number;
  monthsAgo: number;
  lastPurchase: string; // ISO date
}

export interface RecomputeStatsOptions {
  now?: Date; // injectable for tests
}

export interface RecomputeStatsResult {
  customersProcessed: number;
  segmentCounts: Record<string, number>;
  dataCoverage: { min: Date | null; max: Date | null };
}

export async function recomputeStats(
  prisma: PrismaClient,
  opts: RecomputeStatsOptions = {},
): Promise<RecomputeStatsResult> {
  const now = opts.now ?? new Date();

  // Data-coverage window across ALL non-void docs (not just the RFM window) — exposed so
  // the UI can show "your data covers X to Y" and nobody misreads a short window as a
  // real trend (brief §5 "no-silent-caps" / data-coverage requirement).
  const coverage = await prisma.saleDoc.aggregate({
    where: { void: false },
    _min: { date: true },
    _max: { date: true },
  });

  const rfmSince = new Date(now.getTime() - RFM_WINDOW_DAYS * 86400000);
  const trendCurStart = new Date(now.getTime() - TREND_WINDOW_DAYS * 86400000);
  const trendPrevStart = new Date(now.getTime() - 2 * TREND_WINDOW_DAYS * 86400000);

  // Pull every non-void doc within the RFM window (or the trend-previous window if that
  // extends further back — it doesn't, trend windows are inside the RFM window per the
  // brief, but we fetch the wider of the two defensively) with its lines, grouped by
  // customerCode. customerCode (not customerId) is the grouping key — an unmatched code
  // still gets stats; matching happens for display only.
  const earliestNeeded = trendPrevStart < rfmSince ? trendPrevStart : rfmSince;
  const docs = await prisma.saleDoc.findMany({
    where: { void: false, customerCode: { not: null }, date: { gte: earliestNeeded } },
    select: {
      customerCode: true,
      date: true,
      total: true,
      lines: { select: { sku: true, name: true, qty: true, unitPrice: true, amount: true } },
    },
  });

  interface CustAgg {
    code: string;
    docsInRfmWindow: { date: Date; total: number }[];
    lastPurchase: Date | null;
    revenueRfm: number;
    curWindowRevenue: number;
    curWindowOrders: number;
    prevWindowRevenue: number;
    prevWindowOrders: number;
    // per-SKU purchase dates + unit prices, for reorder cycles (all dates in RFM window)
    skuDates: Map<string, Date[]>;
    skuMaxUnitPrice: Map<string, number>;
    skuName: Map<string, string>; // sku -> product name (for display on reorder-due items)
  }
  const byCustomer = new Map<string, CustAgg>();

  function getAgg(code: string): CustAgg {
    let a = byCustomer.get(code);
    if (!a) {
      a = {
        code,
        docsInRfmWindow: [],
        lastPurchase: null,
        revenueRfm: 0,
        curWindowRevenue: 0,
        curWindowOrders: 0,
        prevWindowRevenue: 0,
        prevWindowOrders: 0,
        skuDates: new Map(),
        skuMaxUnitPrice: new Map(),
        skuName: new Map(),
      };
      byCustomer.set(code, a);
    }
    return a;
  }

  for (const doc of docs) {
    const code = doc.customerCode;
    if (!code) continue;
    const date = doc.date;
    const total = parseMoney(doc.total);
    const agg = getAgg(code);

    if (date >= rfmSince) {
      agg.docsInRfmWindow.push({ date, total });
      agg.revenueRfm += total;
      if (!agg.lastPurchase || date > agg.lastPurchase) agg.lastPurchase = date;
      for (const line of doc.lines) {
        if (!line.sku) continue;
        const arr = agg.skuDates.get(line.sku) ?? [];
        arr.push(date);
        agg.skuDates.set(line.sku, arr);
        const up = parseMoney(line.unitPrice);
        const prevMax = agg.skuMaxUnitPrice.get(line.sku) ?? 0;
        if (up > prevMax) agg.skuMaxUnitPrice.set(line.sku, up);
        if (line.name && !agg.skuName.has(line.sku)) agg.skuName.set(line.sku, line.name);
      }
    }

    if (date >= trendCurStart) {
      agg.curWindowRevenue += total;
      agg.curWindowOrders += 1;
    } else if (date >= trendPrevStart) {
      agg.prevWindowRevenue += total;
      agg.prevWindowOrders += 1;
    }
  }

  // Cross-sell links: fetched ONCE upfront (not per-customer) — CrossSellLink is a small
  // shared table (learned bought-together pairs across the whole catalog), never filtered by
  // customer, so a single findMany here is far cheaper than a query per customer in the loop
  // below. Empty in environments with no learned pairings yet (VENUS_BRIEF.md §7: "if
  // CrossSellLink is empty/no gaps -> empty list, no signal") — crossSellGapsFor handles an
  // empty `links` array cleanly (returns []), no special-casing needed here.
  const crossSellLinks: CrossSellLinkRow[] = await prisma.crossSellLink.findMany({
    where: { score: { gt: 0 } },
    select: { anchorSku: true, crossSku: true, score: true },
  });
  const crossSkuNeeded = new Set(crossSellLinks.map((l) => l.crossSku));
  const crossSellProducts = crossSkuNeeded.size
    ? await prisma.product.findMany({
        where: { sku: { in: Array.from(crossSkuNeeded) } },
        select: { sku: true, nameTh: true, nameEn: true },
      })
    : [];
  const crossSellNameBySku = new Map(crossSellProducts.map((p) => [p.sku, p.nameTh || p.nameEn || null]));

  const codes = Array.from(byCustomer.keys());
  const rValues: number[] = []; // days since last purchase (smaller = better -> inverted)
  const fValues: number[] = [];
  const mValues: number[] = [];
  for (const code of codes) {
    const a = byCustomer.get(code)!;
    const r = a.lastPurchase ? daysBetween(now, a.lastPurchase) : RFM_WINDOW_DAYS;
    rValues.push(r);
    fValues.push(a.docsInRfmWindow.length);
    mValues.push(a.revenueRfm);
  }
  const rScores = quintileScores(rValues, true);
  const fScores = quintileScores(fValues, false);
  const mScores = quintileScores(mValues, false);

  const segmentCounts: Record<string, number> = {};

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const a = byCustomer.get(code)!;
    const r = rValues[i];
    const f = fValues[i];
    const m = mValues[i];
    const rScore = rScores[i];
    const fScore = fScores[i];
    const mScore = mScores[i];
    const segment = segmentFor(rScore, fScore, mScore);
    segmentCounts[segment] = (segmentCounts[segment] ?? 0) + 1;

    const trendRevenueDelta = a.curWindowRevenue - a.prevWindowRevenue;
    const trendPct =
      a.prevWindowRevenue > 0
        ? (trendRevenueDelta / a.prevWindowRevenue) * 100
        : a.curWindowRevenue > 0
          ? 100
          : 0;
    const trendDir = trendRevenueDelta > 0.01 ? 'up' : trendRevenueDelta < -0.01 ? 'down' : 'flat';
    const trendOrders = a.curWindowOrders - a.prevWindowOrders;

    // Reorder cycles: per-SKU median gap between purchase dates, >=REORDER_MIN_PURCHASES,
    // excluding equipment (bought once + unit price above threshold).
    const reorderDue: ReorderDueItem[] = [];
    for (const [sku, dates] of a.skuDates) {
      const sorted = [...dates].sort((x, y) => x.getTime() - y.getTime());
      const purchaseCount = sorted.length;
      const maxUnitPrice = a.skuMaxUnitPrice.get(sku) ?? 0;
      if (purchaseCount === 1 && maxUnitPrice > EQUIPMENT_PRICE_THRESHOLD) {
        continue; // one-off big-ticket equipment — not a consumable reorder cycle
      }
      if (purchaseCount < REORDER_MIN_PURCHASES) continue;

      const gaps: number[] = [];
      for (let k = 1; k < sorted.length; k++) gaps.push(daysBetween(sorted[k], sorted[k - 1]));
      gaps.sort((x, y) => x - y);
      const mid = Math.floor(gaps.length / 2);
      const medianGap = gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid];
      if (medianGap <= 0) continue;

      const lastPurchase = sorted[sorted.length - 1];
      const daysSinceLast = daysBetween(now, lastPurchase);
      const dueThreshold = medianGap * REORDER_DUE_MULTIPLIER;
      if (daysSinceLast > dueThreshold) {
        reorderDue.push({
          sku,
          name: a.skuName.get(sku) ?? null,
          lastPurchase: lastPurchase.toISOString(),
          medianGapDays: Math.round(medianGap * 10) / 10,
          dueSinceDays: Math.round(daysSinceLast - dueThreshold),
          purchaseCount,
        });
      }
    }
    reorderDue.sort((x, y) => y.dueSinceDays - x.dueSinceDays);

    // Big-ticket anniversary: reuse the SAME per-SKU aggregation as the reorder-cycle
    // exclusion above (skuDates/skuMaxUnitPrice) — same items, positive signal instead.
    const bigTicket: BigTicketItem[] = [];
    for (const [sku, dates] of a.skuDates) {
      const maxUnitPrice = a.skuMaxUnitPrice.get(sku) ?? 0;
      const hit = bigTicketFor(dates, maxUnitPrice, now);
      if (!hit) continue;
      bigTicket.push({
        sku,
        name: a.skuName.get(sku) ?? null,
        unitPrice: maxUnitPrice,
        monthsAgo: Math.round(hit.monthsAgo * 10) / 10,
        lastPurchase: hit.lastPurchase.toISOString(),
      });
    }
    bigTicket.sort((x, y) => y.monthsAgo - x.monthsAgo);

    // Cross-sell gaps: anchors = every SKU this customer has ever bought (in the RFM window).
    const ownedSkus = new Set(a.skuDates.keys());
    const crossSellGaps: CrossSellGapItem[] = crossSellGapsFor(ownedSkus, crossSellLinks).map((g) => ({
      crossSku: g.crossSku,
      name: crossSellNameBySku.get(g.crossSku) ?? null,
      anchorSku: g.anchorSku,
      score: g.score,
    }));

    await prisma.customerStats.upsert({
      where: { customerCode: code },
      create: {
        customerCode: code,
        r,
        f,
        m,
        rfmScore: `${rScore}${fScore}${mScore}`,
        segment,
        trendPct: Math.round(trendPct * 10) / 10,
        trendDir,
        trendOrders,
        reorderDue: reorderDue.length ? (reorderDue as unknown as object) : undefined,
        crossSellGaps: crossSellGaps.length ? (crossSellGaps as unknown as object) : undefined,
        bigTicket: bigTicket.length ? (bigTicket as unknown as object) : undefined,
        dataFrom: coverage._min.date,
        dataTo: coverage._max.date,
      },
      update: {
        r,
        f,
        m,
        rfmScore: `${rScore}${fScore}${mScore}`,
        segment,
        trendPct: Math.round(trendPct * 10) / 10,
        trendDir,
        trendOrders,
        reorderDue: reorderDue.length ? (reorderDue as unknown as object) : Prisma.JsonNull,
        crossSellGaps: crossSellGaps.length ? (crossSellGaps as unknown as object) : Prisma.JsonNull,
        bigTicket: bigTicket.length ? (bigTicket as unknown as object) : Prisma.JsonNull,
        dataFrom: coverage._min.date,
        dataTo: coverage._max.date,
        computedAt: now,
      },
    });
  }

  return {
    customersProcessed: codes.length,
    segmentCounts,
    dataCoverage: { min: coverage._min.date, max: coverage._max.date },
  };
}
