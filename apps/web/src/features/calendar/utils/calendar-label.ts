import { formatLocale, type TranslationKey, t } from '@app/lib/i18n';
import type { VisibleCalendar } from '@queries/calendar/calendars';
import type { CalendarPeriodView, CalendarSource } from '../types';

const CALENDAR_PERIOD_LABELS = {
  dayGridMonth: 'calendar.viewMonth',
  timeGridWeek: 'calendar.viewWeek',
  timeGridDay: 'calendar.viewDay',
  timeGridThreeDay: 'calendar.viewThreeDays',
  agenda: 'calendar.viewAgenda',
} satisfies Record<CalendarPeriodView, TranslationKey>;

/** Human-readable label for a calendar period view. */
export function calendarPeriodLabel(view: CalendarPeriodView): string {
  return t(CALENDAR_PERIOD_LABELS[view]);
}

/**
 * Display label for a calendar in pickers, filters and event details. Google
 * names primary calendars after the account email and Outlook names its
 * default one "Calendar", so primaries collapse to the inbox address; other
 * calendars carry their inbox only when the visible set spans more than one
 * account.
 */
export function calendarDisplayLabel(
  calendar: Pick<CalendarSource, 'name' | 'emailAddress' | 'isPrimary'>,
  spansInboxes: boolean
): string {
  const { emailAddress } = calendar;
  if (emailAddress && (calendar.isPrimary || calendar.name === emailAddress)) {
    return emailAddress;
  }
  return spansInboxes && emailAddress
    ? `${calendar.name} — ${emailAddress}`
    : calendar.name;
}

/** Whether a calendar list spans more than one connected inbox. */
export function spansMultipleInboxes(
  calendars: readonly Pick<VisibleCalendar, 'emailAddress'>[]
): boolean {
  return new Set(calendars.map((calendar) => calendar.emailAddress)).size > 1;
}

/** Localized month/year heading shared by calendar navigation controls. */
export function calendarMonthLabel(date: Date): string {
  return new Intl.DateTimeFormat(formatLocale(), {
    month: 'long',
    year: 'numeric',
  }).format(date);
}
