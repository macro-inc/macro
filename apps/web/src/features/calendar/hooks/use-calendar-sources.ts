import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import { createMemo } from 'solid-js';
import type { CalendarSource } from '../types';
import { DEFAULT_CALENDAR_SOURCE } from '../types';
import { useCalendarPreferences } from '../utils/preferences';

/** Query-backed calendar sources with presentation colors, grouped by account. */
export function useCalendarSources() {
  const [preferences] = useCalendarPreferences();
  const calendarsQuery = useVisibleCalendarsQuery();
  const sources = createMemo<CalendarSource[]>(() => {
    const calendars = calendarsQuery.isSuccess
      ? calendarsQuery.data
      : undefined;
    if (!calendars || calendars.length === 0) {
      return [DEFAULT_CALENDAR_SOURCE];
    }

    return calendars.map((calendar) => ({
      id: calendar.id,
      name: calendar.name,
      color:
        preferences.sourceColors[calendar.id] ??
        preferences.accountColors[
          calendar.emailLinkId ?? calendar.emailAddress ?? calendar.id
        ] ??
        calendar.color ??
        DEFAULT_CALENDAR_SOURCE.color,
      emailAddress: calendar.emailAddress,
      emailLinkId: calendar.emailLinkId,
      isPrimary: calendar.isPrimary,
      isSubscription: calendar.isSubscription,
      syncError: calendar.syncError ?? undefined,
    }));
  });
  const sourceById = createMemo(
    () => new Map(sources().map((source) => [source.id, source]))
  );

  return { calendarsQuery, sourceById, sources };
}
