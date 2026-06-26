import { env } from '../env.js';

export interface FinancePayload {
  nickname: string;
  realName: string;
  amount: string;
  bank: string;
  transferAt: string;
  ref: string;
  slipUrl: string;
  sales: string;
}

// Forward a payment slip's details to the finance Google Sheet (Apps Script webhook).
// Returns ok=false (never throws) so the caller can surface a clean error.
export async function sendToFinance(p: FinancePayload): Promise<{ ok: boolean; error?: string }> {
  if (!env.FINANCE_SHEET_WEBHOOK) return { ok: false, error: 'not_configured' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(env.FINANCE_SHEET_WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: env.FINANCE_SHEET_SECRET, ...p }),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `http_${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}
