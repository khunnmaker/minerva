import { describe, expect, it } from 'vitest';
import { CALENDAR_MAX_RANGE_DAYS, parseCalendarRange, resolveCalendarAssignee } from '../src/apollo/calendarQuery.js';

describe('Apollo calendar date-range validation', () => {
  it('accepts a range up to and including the 62-day cap, rejects anything past it', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const atCap = new Date(from.getTime() + CALENDAR_MAX_RANGE_DAYS * 86_400_000).toISOString().slice(0, 10);
    const overCap = new Date(from.getTime() + (CALENDAR_MAX_RANGE_DAYS + 1) * 86_400_000).toISOString().slice(0, 10);

    expect(parseCalendarRange('2026-01-01', atCap)).toEqual({ from, to: new Date(`${atCap}T00:00:00.000Z`) });
    expect(parseCalendarRange('2026-01-01', overCap)).toBeNull();
    // A single calendar month (the frontend's actual usage) is always well inside the cap.
    expect(parseCalendarRange('2026-07-01', '2026-07-31')).not.toBeNull();
  });

  it('rejects malformed or non-calendar dates and an inverted range', () => {
    expect(parseCalendarRange('2026-02-30', '2026-03-01')).toBeNull(); // Feb 30 doesn't exist
    expect(parseCalendarRange('2026/07/01', '2026-07-31')).toBeNull(); // wrong separator
    expect(parseCalendarRange('2026-07-31', '2026-07-01')).toBeNull(); // to before from
  });
});

describe('Apollo calendar assignee scoping', () => {
  it('forces employees to themselves no matter what the assignee param says', () => {
    expect(resolveCalendarAssignee(false, 'self-1', 'someone-else')).toBe('self-1');
    expect(resolveCalendarAssignee(false, 'self-1', 'all')).toBe('self-1');
    expect(resolveCalendarAssignee(false, 'self-1', 'none')).toBe('self-1');
    expect(resolveCalendarAssignee(false, 'self-1', undefined)).toBe('self-1');
  });

  it('lets managers scope to one agent, unassigned-only, or everyone', () => {
    expect(resolveCalendarAssignee(true, 'mgr-1', 'agent-9')).toBe('agent-9');
    expect(resolveCalendarAssignee(true, 'mgr-1', 'none')).toBeNull();
    expect(resolveCalendarAssignee(true, 'mgr-1', 'all')).toBeUndefined();
    expect(resolveCalendarAssignee(true, 'mgr-1', undefined)).toBeUndefined();
  });
});
