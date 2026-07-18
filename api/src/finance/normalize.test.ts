import { describe, expect, it } from 'vitest';
import { normalizeSlipDate, parseSlipDate, resolveSlipTransferAt } from './normalize.js';

describe('normalizeSlipDate', () => {
  const shortMonths = [
    ['ม.ค.', '01'], ['ก.พ.', '02'], ['มี.ค.', '03'], ['เม.ย.', '04'],
    ['พ.ค.', '05'], ['มิ.ย.', '06'], ['ก.ค.', '07'], ['ส.ค.', '08'],
    ['ก.ย.', '09'], ['ต.ค.', '10'], ['พ.ย.', '11'], ['ธ.ค.', '12'],
  ] as const;

  it.each(shortMonths)('maps Thai short month %s to %s', (thai, month) => {
    expect(normalizeSlipDate(`8 ${thai} 2569 19:27`)).toBe(`08/${month}/2026 19:27`);
  });

  it('maps full Thai month names and tolerates punctuation/spacing', () => {
    expect(normalizeSlipDate('8 มกราคม 2569 19:27')).toBe('08/01/2026 19:27');
    expect(normalizeSlipDate('8 / กรกฎาคม / 2569 19:27')).toBe('08/07/2026 19:27');
    expect(normalizeSlipDate('8 ก . ค . 2569 19:27')).toBe('08/07/2026 19:27');
  });

  it('normalizes the reported July case and Thai digits', () => {
    expect(normalizeSlipDate('8 ก.ค. 2569 19:27')).toBe('08/07/2026 19:27');
    expect(normalizeSlipDate('๘ ก.ค. ๒๕๖๙ ๑๙:๒๗')).toBe('08/07/2026 19:27');
  });

  it('keeps numeric and ISO regressions while dropping seconds', () => {
    expect(normalizeSlipDate('08/01/2569 19:27')).toBe('08/01/2026 19:27');
    expect(normalizeSlipDate('08/01/69 19:27')).toBe('08/01/2026 19:27');
    expect(normalizeSlipDate('2026-01-08 19:27')).toBe('08/01/2026 19:27');
    expect(normalizeSlipDate('08/07/2569 19:27:41')).toBe('08/07/2026 19:27');
    expect(normalizeSlipDate('13/01/2026 09:52')).toBe('13/01/2026 09:52');
  });

  it('tolerates verbatim printed labels, น. suffixes, and dash time separators', () => {
    expect(normalizeSlipDate('วันที่ทำรายการ 04/07/2569 15:54:05')).toBe('04/07/2026 15:54');
    expect(normalizeSlipDate('08 ก.ค. 69 19:27 น.')).toBe('08/07/2026 19:27');
    expect(normalizeSlipDate('เวลาโอน ๘ ก.ค. ๒๕๖๙ ๑๙:๒๗:๔๑ น.')).toBe('08/07/2026 19:27');
    expect(normalizeSlipDate('04/07/2569 - 15:54')).toBe('04/07/2026 15:54');
  });

  it.each(['31/02/2569 10:00', '99/99/2569 99:99', 'ก.ค.'])(
    'passes invalid input through and reports failure: %s',
    (raw) => {
      expect(normalizeSlipDate(raw)).toBe(raw);
      expect(parseSlipDate(raw)).toEqual({ ok: false, normalized: raw });
    },
  );
});

describe('resolveSlipTransferAt', () => {
  const arrivedAt = new Date('2026-07-08T12:28:00.000Z'); // 19:28 Bangkok

  it('locks only a successfully parsed slip timestamp', () => {
    expect(resolveSlipTransferAt('8 ก.ค. 2569 19:27', arrivedAt)).toEqual({
      value: '08/07/2026 19:27', fromSlip: true, parseFailed: false,
    });
  });

  it('keeps failed raw OCR editable', () => {
    expect(resolveSlipTransferAt('31/02/2569 10:00', arrivedAt)).toEqual({
      value: '31/02/2569 10:00', fromSlip: false, parseFailed: true,
    });
  });

  it('prefills arrival time only when OCR is blank', () => {
    expect(resolveSlipTransferAt('  ', arrivedAt)).toEqual({
      value: '08/07/2026 19:28', fromSlip: false, parseFailed: false,
    });
  });
});
