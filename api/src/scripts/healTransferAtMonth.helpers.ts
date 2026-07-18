import { parseSlipDate } from '../finance/normalize.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface HealPaymentLike {
  amount: string;
  transferAt: string;
  createdAt: Date;
}

export interface HealTxnLike {
  id: string;
  amount: string;
  txnAt: Date;
  direction: string;
}

export type HealEvidence =
  | { evidenceClass: 'G1' | 'G2'; txnId: string; proposed: string }
  | { evidenceClass: 'MANUAL'; txnId: null; proposed: null };

interface StrictSlipTimestamp {
  instant: Date;
  day: number;
  minute: string;
}

function amountsEqualAt2dp(a: string, b: string): boolean {
  const toSatang = (value: string) => {
    const cleaned = value.replace(/,/g, '').trim();
    return /^\d+(?:\.\d+)?$/.test(cleaned) ? Math.round(Number(cleaned) * 100) : Number.NaN;
  };
  const left = toSatang(a);
  const right = toSatang(b);
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}

function strictSlipTimestamp(raw: string): StrictSlipTimestamp | null {
  const parsed = parseSlipDate(raw);
  if (!parsed.ok) return null;
  const match = parsed.normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, dd, mm, yyyy, hh, min] = match;
  const instant = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00+07:00`);
  if (Number.isNaN(instant.getTime())) return null;
  return { instant, day: Number(dd), minute: `${hh}:${min}` };
}

export function bangkokTransferAt(date: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

export function isHealCandidate(payment: HealPaymentLike): boolean {
  const parsed = strictSlipTimestamp(payment.transferAt);
  return parsed !== null && Math.abs(parsed.instant.getTime() - payment.createdAt.getTime()) > 14 * DAY_MS;
}

export function selectHealEvidence(
  payment: HealPaymentLike,
  linkedTxns: HealTxnLike[],
  inboundTxns: HealTxnLike[],
): HealEvidence {
  const current = strictSlipTimestamp(payment.transferAt);
  if (!current) return { evidenceClass: 'MANUAL', txnId: null, proposed: null };

  // G1 is deliberately first and ignores matchStatus: an existing link plus equal 2dp amount
  // is the strongest independent evidence. Stable ordering keeps an unusual multi-link row auditable.
  const linkedEqual = linkedTxns
    .filter((txn) => txn.direction === 'in' && amountsEqualAt2dp(txn.amount, payment.amount))
    .sort((a, b) => a.txnAt.getTime() - b.txnAt.getTime() || a.id.localeCompare(b.id));
  if (linkedEqual.length > 0) {
    const txn = linkedEqual[0];
    return { evidenceClass: 'G1', txnId: txn.id, proposed: bangkokTransferAt(txn.txnAt) };
  }

  // G2 requires one and only one equal-amount inbound line agreeing on Bangkok day + minute
  // inside the payment-createdAt audit window. Bank match status is intentionally irrelevant.
  const candidates = inboundTxns.filter((txn) => {
    if (txn.direction !== 'in' || !amountsEqualAt2dp(txn.amount, payment.amount)) return false;
    if (Math.abs(txn.txnAt.getTime() - payment.createdAt.getTime()) > 35 * DAY_MS) return false;
    const proposed = bangkokTransferAt(txn.txnAt);
    const match = proposed.match(/^(\d{2})\/\d{2}\/\d{4}\s+(\d{2}:\d{2})$/);
    return !!match && Number(match[1]) === current.day && match[2] === current.minute;
  });
  if (candidates.length === 1) {
    const txn = candidates[0];
    return { evidenceClass: 'G2', txnId: txn.id, proposed: bangkokTransferAt(txn.txnAt) };
  }
  return { evidenceClass: 'MANUAL', txnId: null, proposed: null };
}
