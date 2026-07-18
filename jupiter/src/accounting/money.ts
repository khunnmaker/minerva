// Exact two-decimal money arithmetic for the Phase-2 ledger UI.
//
// The server always sends/accepts amounts as fixed two-decimal Strings (see
// api/src/jupiter/ledger/money.ts) — never JS numbers. This module must be the ONLY place the
// ledger UI turns those strings into arithmetic, and it does so via integer satang (BigInt),
// never `parseFloat`/`Number`, so large or oddly-formatted values never silently lose a satang.

const MONEY_RE = /^-?\d+(\.\d{1,2})?$/;

// True for anything the server's own decimal-string parser would accept (sign, integer part,
// optional 1-2 decimal digits). Used to flag bad input before it's coerced to "0.00".
export function isValidMoneyInput(value: string): boolean {
  return MONEY_RE.test(value.trim());
}

// Parse a decimal string into integer satang. Invalid/empty input -> 0n (never throws — the UI
// treats an unparsable in-progress keystroke as "not yet contributing" rather than crashing).
export function toCents(value: string | null | undefined): bigint {
  const trimmed = (value ?? '').trim();
  if (!trimmed || !MONEY_RE.test(trimmed)) return 0n;
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ''] = unsigned.split('.');
  const cents = BigInt(intPart || '0') * 100n + BigInt((fracPart + '00').slice(0, 2) || '0');
  return negative ? -cents : cents;
}

// Integer satang -> canonical "0.00"-style decimal string (matches the server's moneyToString).
export function centsToMoneyString(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const intPart = abs / 100n;
  const fracPart = abs % 100n;
  return `${negative && abs !== 0n ? '-' : ''}${intPart.toString()}.${fracPart.toString().padStart(2, '0')}`;
}

// Coerce any user-typed amount into the server's canonical two-decimal String, rounding nothing
// (invalid input becomes "0.00" — pair this with isValidMoneyInput to warn the user first).
export function normalizeMoney(value: string | null | undefined): string {
  return centsToMoneyString(toCents(value));
}

export function sumMoney(values: (string | null | undefined)[]): string {
  return centsToMoneyString(values.reduce((sum: bigint, v) => sum + toCents(v), 0n));
}

export function subtractMoney(a: string, b: string): string {
  return centsToMoneyString(toCents(a) - toCents(b));
}

export function isZeroMoney(value: string | null | undefined): boolean {
  return toCents(value) === 0n;
}

// Thousands-separated display, preserves sign and exact 2 decimals — no rounding, no float.
export function formatMoneyDisplay(value: string | null | undefined): string {
  const trimmed = (value ?? '0.00').trim();
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = '00'] = unsigned.split('.');
  const withSep = (intPart || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${withSep}.${fracPart.padEnd(2, '0').slice(0, 2)}`;
}
