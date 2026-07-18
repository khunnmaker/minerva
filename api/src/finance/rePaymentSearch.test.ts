import { describe, expect, it } from 'vitest';
import { nearAmountTolerance, reSearchCore, searchedAmount } from './rePaymentSearch.js';

describe('bank-first RE/payment search normalization', () => {
  it('normalizes RE prefixes and dashes to the stored core', () => {
    expect(reSearchCore('RE-6907674')).toBe('6907674');
    expect(reSearchCore('690-7674')).toBe('6907674');
  });

  it('recognizes FIN-style amount searches', () => {
    expect(searchedAmount('1810')).toBe(1810);
    expect(searchedAmount('฿1,810.00')).toBe(1810);
    expect(nearAmountTolerance(1810)).toBe(36.2);
  });
});
