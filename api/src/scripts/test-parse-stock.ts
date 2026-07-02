// Regression test for parseExpressReport — no test framework exists in this repo, so
// this is a plain script: exits 1 on any failure, prints PASS/FAIL per case.
//
//   npx tsx src/scripts/test-parse-stock.ts
import { parseExpressReport } from '../stock/parseExpressReport.js';

interface Case {
  name: string;
  line: string;
  expectSku?: string;
  expectQty?: number; // undefined when the case expects UNRESOLVED (no row)
  unresolved?: boolean;
}

const cases: Case[] = [
  {
    name: 'invariant branch (value = qty * cost)',
    line: '  01-01-01 TRAY MATERIAL 1 kg 58.00 XX 610.00 35,380.00',
    expectSku: '01-01-01',
    expectQty: 58,
  },
  {
    name: 'invariant branch, different numbers',
    line: '  01-01-04 TRAY MATERIAL 500 g 38.00 XX 320.79 12,190.00',
    expectSku: '01-01-04',
    expectQty: 38,
  },
  {
    name: 'invariant branch with numbers in the name',
    line: '  01-01-34 GOODYS HARD SPLINT 0.5mm 127 SQURES/40 84.00 XX 395.24 33,200.00',
    expectSku: '01-01-34',
    expectQty: 84,
  },
  {
    name: 'zero-qty, negative value',
    line: '  01-01-07 TRAY MATERIAL XX 1 kg 0.00 XX -760.00',
    expectSku: '01-01-07',
    expectQty: 0,
  },
  {
    name: 'zero-qty, cost printed, value omitted',
    line: '  01-01-11 TRAY MATERIAL 15 kg 0.00 XX 748.68',
    expectSku: '01-01-11',
    expectQty: 0,
  },
  {
    name: 'qty + zero value, no cost',
    line: '  01-01-44 GOODYS HARD SPLINT 0.75mm 125 ROUND/30 2.00 XX 0.00',
    expectSku: '01-01-44',
    expectQty: 2,
  },
  {
    name: 'qty + zero value, no cost (same shape)',
    line: '  01-02-10 SELF CURE XX 500g 9.00 XX 0.00',
    expectSku: '01-02-10',
    expectQty: 9,
  },
  {
    name: 'ambiguous [x, 0, 0] tail -> unresolved',
    line: '  09-99-99 WIDGET ZERO COST 5.00 XX 0.00 0.00',
    expectSku: '09-99-99',
    unresolved: true,
  },
];

let failed = 0;

function check(cond: boolean, label: string) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    console.log(`FAIL: ${label}`);
    failed++;
  }
}

// Cases 1-8: one line each, run individually so unresolved-vs-resolved is unambiguous.
for (const c of cases) {
  const result = parseExpressReport(c.line);
  if (c.unresolved) {
    check(result.rows.length === 0, `${c.name}: no row emitted`);
    check(result.unresolved === 1, `${c.name}: unresolved === 1`);
  } else {
    const row = result.rows.find((r) => r.sku === c.expectSku);
    check(!!row, `${c.name}: row found for ${c.expectSku}`);
    check(row?.qty === c.expectQty, `${c.name}: qty === ${c.expectQty} (got ${row?.qty})`);
    check(result.unresolved === 0, `${c.name}: unresolved === 0`);
  }
}

// Case 8 (again): assert unresolvedSamples is populated and capped at 5, matching unresolved count.
{
  const ambiguous = cases.find((c) => c.unresolved)!;
  const result = parseExpressReport(ambiguous.line);
  check(result.unresolvedSamples.length === Math.min(result.unresolved, 5), 'case 8: unresolvedSamples length matches unresolved (capped at 5)');
  check(result.unresolvedSamples.length === 1, 'case 8: unresolvedSamples has exactly 1 sample for 1 unresolved line');
}

// Case 9: a sub-line and a header line mixed in with a real SKU line — sub-line/header
// don't match the dd-dd-n SKU regex, so they're skipped entirely (no row, no unresolved).
{
  const text = [
    '  02 XX 58.00',
    'XX 01-00-01 XX 99-99-99 XX',
    '  01-01-01 TRAY MATERIAL 1 kg 58.00 XX 610.00 35,380.00',
  ].join('\n');
  const result = parseExpressReport(text);
  check(result.lineCount === 1, `mixed sub-line/header: lineCount === 1 (got ${result.lineCount})`);
  check(result.unresolved === 0, `mixed sub-line/header: unresolved === 0 (got ${result.unresolved})`);
  check(result.rows.length === 1 && result.rows[0].sku === '01-01-01', 'mixed sub-line/header: only the real SKU line produced a row');
}

// Case 10: duplicate SKU lines -> last occurrence wins.
{
  const text = [
    '  01-01-01 TRAY MATERIAL 1 kg 58.00 XX 610.00 35,380.00',
    '  01-01-01 TRAY MATERIAL 1 kg 99.00 XX 610.00 60,390.00',
  ].join('\n');
  const result = parseExpressReport(text);
  check(result.rows.length === 1, `duplicate SKU: exactly one row (got ${result.rows.length})`);
  check(result.rows[0]?.qty === 99, `duplicate SKU: last occurrence wins (qty 99, got ${result.rows[0]?.qty})`);
}

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
} else {
  console.log('\nAll checks PASSED');
}
