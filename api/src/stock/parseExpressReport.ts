import iconv from 'iconv-lite';

// Parser for Prominent's Express stock report ("รายงานสินค้าคงเหลือ"). This is NOT a
// CSV — it's a fixed-width print report exported as a .txt, encoded in Windows-874
// (TIS-620 superset, Thai). Ported from scripts/parse_stock.js, which Vulcan replaces.
//
// A stock line looks like:
//   <SKU> <name…> <QTY> <unit> <cost> <value>     where value = qty × cost
// The name itself can contain numbers (e.g. "GOODYS HARD SPLINT 0.5mm 127 SQURES/40"),
// so we DON'T anchor on column/number position from the left. Instead we anchor on the
// arithmetic invariant from the RIGHT — value = qty × cost (cost = average cost, ~2%
// rounding tolerance; cost/value go negative when oversold/below-cost). Numbers are
// always clean ASCII even where the Thai is mojibake, so this is robust.
//
// When the invariant doesn't resolve it, a [x, 0, 0] tail (cost 0, value 0) is
// ambiguous — it could be "qty=x in stock, cost 0" OR a qty-0 line whose name happens
// to end in a number x. We don't guess: that shape is flagged unresolved for human
// review instead of silently picking a side. Unambiguous zero-qty shapes (qty column
// itself is the printed 0, or a nonzero number sits right before a 0/negative value)
// are still resolved automatically.
//
// Per-SKU sub-lines ("02 คลังหน้าร้าน 58.00", "ยอดยกไป…E … F") and page headers don't
// start with a dd-dd-n SKU code, so they're skipped by skuRe.

export interface ParsedStockRow {
  sku: string;
  name: string; // product name as printed (everything before the qty token)
  qty: number;
}

export interface ParseResult {
  rows: ParsedStockRow[]; // one per unique SKU (last occurrence wins)
  lineCount: number; // SKU lines seen
  unresolved: number; // SKU lines we couldn't extract a qty from
  unresolvedSamples: string[]; // up to 5 raw offending lines, for human review
}

const SKU_RE = /^\s*(\d{2}-\d{2}-\d+)\s+(.*)$/;
const NUM_RE = /-?[\d,]+(?:\.\d+)?/g;

const toNum = (s: string) => parseFloat(s.replace(/,/g, ''));
const tol = (v: number) => Math.max(1, Math.abs(v) * 0.02);

// Decode raw uploaded bytes. Express exports Windows-874/TIS-620; we decode that so
// Thai names are correct. (If a file is already UTF-8, win874-decoding ASCII digits/
// latin is still fine — only high bytes differ, and the qty logic is ASCII-only.)
export function decodeExpressBytes(buf: Buffer): { text: string; encoding: string } {
  // Heuristic: a valid UTF-8 file rarely contains lone 0x80–0x9F bytes that aren't part
  // of a multibyte sequence; Express TIS-620 uses 0xA1–0xFB heavily. Default to win874.
  const text = iconv.decode(buf, 'win874');
  return { text, encoding: 'windows-874' };
}

export function parseExpressReport(text: string): ParseResult {
  const lines = text.split(/\r?\n/);
  const bySku = new Map<string, ParsedStockRow>();
  let lineCount = 0;
  let unresolved = 0;
  const unresolvedSamples: string[] = [];
  const sample = (line: string) => {
    if (unresolvedSamples.length < 5) unresolvedSamples.push(line.trim().slice(0, 100));
  };

  for (const line of lines) {
    const m = line.match(SKU_RE);
    if (!m) continue;
    lineCount++;
    const sku = m[1].toUpperCase();
    const rest = m[2];

    // Collect every number substring WITH its position, so we can both validate qty
    // (from the right) and slice the name (text before the qty token).
    const matches = [...rest.matchAll(NUM_RE)];
    const nums = matches.map((x) => toNum(x[0])).filter((n) => !Number.isNaN(n));
    if (!nums.length) {
      unresolved++;
      sample(line);
      continue;
    }

    const last = nums[nums.length - 1];
    let qty: number | null = null;
    let qtyIdx = -1; // index into `matches`/`nums` of the qty token

    if (nums.length >= 3) {
      const cost = nums[nums.length - 2];
      const q = nums[nums.length - 3];
      if (cost !== 0 && Math.abs(q * cost - last) <= tol(last)) {
        qty = q;
        qtyIdx = nums.length - 3;
      }
    }
    // Ambiguous [x, 0, 0] tail: could be "qty=x, cost 0, value 0" (x in stock) OR a
    // qty-0 line whose name ends in a number. Both satisfy the arithmetic — don't
    // guess; flag for human review via the unresolved count in the preview.
    if (qty === null && nums.length >= 3 && nums[nums.length - 2] === 0 && last === 0 && nums[nums.length - 3] !== 0) {
      unresolved++;
      sample(line);
      continue;
    }
    // "… 0.00 <unit> <cost-or-negative-value>" — qty is the zero itself.
    if (qty === null && nums.length >= 2 && nums[nums.length - 2] === 0) {
      qty = 0;
      qtyIdx = nums.length - 2;
    }
    // value 0/negative with a nonzero number before it → that number is the qty
    // (cost column omitted on these lines in the real report).
    if (qty === null && nums.length >= 2 && last <= 0) {
      qty = nums[nums.length - 2];
      qtyIdx = nums.length - 2;
    }
    if (qty === null) {
      unresolved++;
      sample(line);
      continue;
    }

    // Name = everything before the qty token's position (NaN-filtering can't shift the
    // index because Express numbers always parse, so matches[] and nums[] align 1:1).
    const at = matches[qtyIdx]?.index ?? rest.length;
    const name = rest.slice(0, at).replace(/\s+/g, ' ').trim();

    bySku.set(sku, { sku, name, qty: Math.round(qty) });
  }

  return { rows: [...bySku.values()], lineCount, unresolved, unresolvedSamples };
}
