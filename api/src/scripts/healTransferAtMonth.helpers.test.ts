import { describe, expect, it } from 'vitest';
import { bangkokTransferAt, isHealCandidate, selectHealEvidence, type HealTxnLike } from './healTransferAtMonth.helpers.js';

const createdAt = new Date('2026-07-08T13:00:00.000Z');
const payment = { amount: '1,500.00', transferAt: '08/01/2026 19:27', createdAt };
const txn = (id: string, iso: string, amount = '1500', direction = 'in'): HealTxnLike => ({
  id, txnAt: new Date(iso), amount, direction,
});

describe('healTransferAtMonth evidence gates', () => {
  it('targets only strict dates over 14 days from createdAt', () => {
    expect(isHealCandidate(payment)).toBe(true);
    expect(isHealCandidate({ ...payment, transferAt: '31/02/2569 19:27' })).toBe(false);
    expect(isHealCandidate({ ...payment, transferAt: '08/07/2026 19:27' })).toBe(false);
  });

  it('formats a transaction in Bangkok time', () => {
    expect(bangkokTransferAt(new Date('2026-07-08T12:27:41.000Z'))).toBe('08/07/2026 19:27');
  });

  it('uses G1 for an equal-amount linked inbound transaction before G2', () => {
    const linked = txn('linked', '2026-07-08T12:27:41.000Z', '1500.0');
    const other = txn('other', '2026-08-08T12:27:00.000Z');
    expect(selectHealEvidence(payment, [linked], [other])).toEqual({
      evidenceClass: 'G1', txnId: 'linked', proposed: '08/07/2026 19:27',
    });
  });

  it('uses G2 only for exactly one matching day/minute/amount in the 35-day window', () => {
    const unique = txn('unique', '2026-07-08T12:27:41.000Z');
    expect(selectHealEvidence(payment, [], [unique])).toEqual({
      evidenceClass: 'G2', txnId: 'unique', proposed: '08/07/2026 19:27',
    });
    expect(selectHealEvidence(payment, [], [unique, txn('duplicate', '2026-08-08T12:27:00.000Z')])).toEqual({
      evidenceClass: 'MANUAL', txnId: null, proposed: null,
    });
  });

  it('leaves mismatched, outbound, and out-of-window evidence manual', () => {
    expect(selectHealEvidence(payment, [], [
      txn('amount', '2026-07-08T12:27:00.000Z', '1501'),
      txn('out', '2026-07-08T12:27:00.000Z', '1500', 'out'),
      txn('old', '2026-05-08T12:27:00.000Z'),
    ])).toEqual({ evidenceClass: 'MANUAL', txnId: null, proposed: null });
  });
});
