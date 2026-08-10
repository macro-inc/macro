import type { VisibleCalendar } from '@queries/calendar/calendars';

/**
 * Display label for a calendar in pickers and filters. Google names primary
 * calendars after the account email, so primaries collapse to the inbox
 * address; other calendars carry their inbox only when the visible set spans
 * more than one account.
 */
export function calendarDisplayLabel(
  calendar: Pick<VisibleCalendar, 'name' | 'emailAddress' | 'isPrimary'>,
  spansInboxes: boolean
): string {
  if (calendar.isPrimary || calendar.name === calendar.emailAddress) {
    return calendar.emailAddress;
  }
  return spansInboxes
    ? `${calendar.name} — ${calendar.emailAddress}`
    : calendar.name;
}

/** Whether a calendar list spans more than one connected inbox. */
export function spansMultipleInboxes(
  calendars: readonly Pick<VisibleCalendar, 'emailAddress'>[]
): boolean {
  return new Set(calendars.map((calendar) => calendar.emailAddress)).size > 1;
}
