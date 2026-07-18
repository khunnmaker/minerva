// Normalize slip fields to ONE consistent form for the finance sheet, regardless of how
// the bank/app printed them (ISO vs DD/MM/YYYY, Buddhist พ.ศ. vs Gregorian ค.ศ., Thai digits).

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

const THAI_MONTHS = new Map<string, number>([
  ['มค', 1], ['มกราคม', 1],
  ['กพ', 2], ['กุมภาพันธ์', 2],
  ['มีค', 3], ['มีนาคม', 3],
  ['เมย', 4], ['เมษายน', 4],
  ['พค', 5], ['พฤษภาคม', 5],
  ['มิย', 6], ['มิถุนายน', 6],
  ['กค', 7], ['กรกฎาคม', 7],
  ['สค', 8], ['สิงหาคม', 8],
  ['กย', 9], ['กันยายน', 9],
  ['ตค', 10], ['ตุลาคม', 10],
  ['พย', 11], ['พฤศจิกายน', 11],
  ['ธค', 12], ['ธันวาคม', 12],
]);

export interface ParsedSlipDate {
  ok: boolean;
  normalized: string;
}

function gregorianYear(rawYear: string): number {
  let year = Number(rawYear);
  if (rawYear.length === 2) year = year >= 50 ? 2500 + year : 2000 + year;
  if (year >= 2500) year -= 543;
  return year;
}

function validDateTime(day: number, month: number, year: number, hour: number, minute: number, second: number): boolean {
  if (!Number.isInteger(year) || year < 1 || month < 1 || month > 12) return false;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

// Strictly parse a slip date. Failure deliberately carries the original input through so legacy
// callers keep their passthrough contract while callers that need provenance can inspect `ok`.
export function parseSlipDate(raw: string): ParsedSlipDate {
  if (!raw) return { ok: false, normalized: raw };
  const text = raw
    .replace(/[๐-๙]/g, (digit) => String(THAI_DIGITS.indexOf(digit)))
    .trim()
    // Verbatim OCR carries printed labels/suffixes along with the timestamp: drop everything
    // before the first digit (วันที่ทำรายการ, วันเวลาโอน, เวลา …) and a trailing น./นาฬิกา marker.
    .replace(/^[^\d]*(?=\d)/, '')
    .replace(/\s*(?:น\.?|นาฬิกา)\s*$/, '');

  let dayText = '';
  let monthText = '';
  let yearText = '';
  let hourText: string | undefined;
  let minuteText: string | undefined;
  let secondText: string | undefined;

  // Time may follow the date after spaces, a comma, T (ISO), or a printed dash: "… 2569 - 19:27".
  const timeSuffix = '(?:(?:[T\\s,]+|\\s*[-–]\\s*)(\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?';
  let match = text.match(new RegExp(`^(\\d{4})\\s*[-/.]\\s*(\\d{1,2})\\s*[-/.]\\s*(\\d{1,2})${timeSuffix}$`));
  if (match) {
    [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  } else {
    match = text.match(new RegExp(`^(\\d{1,2})\\s*[-/.]\\s*(\\d{1,2})\\s*[-/.]\\s*(\\d{2}|\\d{4})${timeSuffix}$`));
    if (match) {
      [, dayText, monthText, yearText, hourText, minuteText, secondText] = match;
    } else {
      // Thai abbreviations tolerate punctuation and spaces: ก.ค., ก ค, ก . ค . all map to July.
      match = text.match(new RegExp(`^(\\d{1,2})\\s*(?:[/.-]\\s*)?([ก-๛.\\s]+?)\\s*(?:[/.-]\\s*)?(\\d{2}|\\d{4})${timeSuffix}$`));
      if (!match) return { ok: false, normalized: raw };
      [, dayText, monthText, yearText, hourText, minuteText, secondText] = match;
      const thaiMonth = THAI_MONTHS.get(monthText.replace(/[.\s]/g, ''));
      if (!thaiMonth) return { ok: false, normalized: raw };
      monthText = String(thaiMonth);
    }
  }

  const day = Number(dayText);
  const month = Number(monthText);
  const year = gregorianYear(yearText);
  const hour = hourText === undefined ? 0 : Number(hourText);
  const minute = minuteText === undefined ? 0 : Number(minuteText);
  const second = secondText === undefined ? 0 : Number(secondText);
  if (!validDateTime(day, month, year, hour, minute, second)) return { ok: false, normalized: raw };

  const date = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  const time = hourText === undefined ? '' : ` ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { ok: true, normalized: `${date}${time}` };
}

// → "DD/MM/YYYY HH:MM" with a Gregorian year. Unparseable/invalid input is unchanged.
export function normalizeSlipDate(input: string): string {
  return parseSlipDate(input).normalized;
}

export interface ResolvedSlipTransferAt {
  value: string;
  fromSlip: boolean;
  parseFailed: boolean;
}

// Prefer a timestamp that was both read from the slip and parsed successfully. Raw nonblank OCR
// remains visible/editable on failure; LINE arrival time is only a blank-value prefill.
export function resolveSlipTransferAt(
  ocrTransferAt: string,
  lineArrivedAt: Date,
): ResolvedSlipTransferAt {
  const raw = ocrTransferAt.trim();
  const parsed = parseSlipDate(raw);
  if (parsed.ok) return { value: parsed.normalized, fromSlip: true, parseFailed: false };
  if (raw) return { value: raw, fromSlip: false, parseFailed: true };

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(lineArrivedAt);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    value: `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`,
    fromSlip: false,
    parseFailed: false,
  };
}

// → a plain 2-decimal number string (strip ฿, commas, spaces). "1,500" → "1500.00".
export function normalizeAmount(input: string): string {
  const cleaned = (input || '').replace(/[^\d.]/g, '');
  if (!cleaned) return '';
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? cleaned : n.toFixed(2);
}
