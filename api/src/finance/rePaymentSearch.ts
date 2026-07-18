// Normalization shared by the bank-first RE/payment search route and its tests.
// Stored RE numbers are bare seven-digit cores; FIN commonly types RE-, spaces, or dashes.
export function reSearchCore(value: string): string | null {
  const core = value.trim().replace(/^re[\s-]*/i, '').replace(/[\s-]/g, '');
  return /^\d{2,7}$/.test(core) ? core : null;
}

export function searchedAmount(value: string): number | null {
  const normalized = value.trim().replace(/[฿,\s]/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

// Keep the same "near amount" band used by the existing bank suggestions.
export function nearAmountTolerance(amount: number): number {
  return Math.max(1, amount * 0.02);
}
