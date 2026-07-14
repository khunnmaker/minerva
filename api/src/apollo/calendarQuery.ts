import { z } from 'zod';

// Pure logic for GET /api/apollo/calendar — date-range validation and per-role assignee
// scoping, split out from the route handler so both are unit-testable without a Fastify
// harness (this codebase has none; mirrors the recurrence.ts split for the same reason).

// YYYY-MM-DD format guard — the same shape apollo.ts's task bodies validate dueDate with.
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Parses a YYYY-MM-DD string to a UTC-midnight Date, rejecting non-calendar dates (e.g. Feb 30). */
export function parseDate(value: string): Date | null {
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : d;
}

export const CALENDAR_MAX_RANGE_DAYS = 62;

export interface CalendarRange { from: Date; to: Date }

/**
 * Validates + parses the calendar endpoint's from/to pair: both must be real calendar dates,
 * from must not be after to, and the span must not exceed CALENDAR_MAX_RANGE_DAYS. Returns
 * null on any failure so the route can respond 400 without inspecting the reason.
 */
export function parseCalendarRange(from: string, to: string): CalendarRange | null {
  const fromDate = parseDate(from);
  const toDate = parseDate(to);
  if (!fromDate || !toDate || fromDate > toDate) return null;
  const spanDays = (toDate.getTime() - fromDate.getTime()) / 86_400_000;
  return spanDays > CALENDAR_MAX_RANGE_DAYS ? null : { from: fromDate, to: toDate };
}

/**
 * Resolves the effective assignee filter for GET /api/apollo/calendar.
 * - employees are force-scoped to themselves server-side, regardless of the assignee param
 *   (the param is ignored entirely — never trust a client to self-restrict).
 * - managers: a specific agentId scopes to that person; 'none' scopes to unassigned tasks
 *   (assigneeId: null); 'all' or omitted means no assignee filter at all.
 * Returns a string to filter to one assignee, null to filter to unassigned-only, or
 * undefined for no filter (caller should omit assigneeId from the where clause).
 */
export function resolveCalendarAssignee(isManager: boolean, selfId: string, assignee: string | undefined): string | null | undefined {
  if (!isManager) return selfId;
  if (!assignee || assignee === 'all') return undefined;
  if (assignee === 'none') return null;
  return assignee;
}
