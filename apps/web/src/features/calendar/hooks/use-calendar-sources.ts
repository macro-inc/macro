import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import { createMemo } from 'solid-js';
import type { CalendarSource } from '../types';
import { DEFAULT_CALENDAR_SOURCE } from '../types';
import {
  calendarDisplayLabel,
  spansMultipleInboxes,
} from '../utils/calendar-label';

/** Query-backed calendar sources with presentation labels and colors. */
export function useCalendarSources() {
  const calendarsQuery = useVisibleCalendarsQuery();
  const sources = createMemo<CalendarSource[]>(() => {
    const calendars = calendarsQuery.data;
    if (!calendars || calendars.length === 0) {
      return [DEFAULT_CALENDAR_SOURCE];
    }

    const spansInboxes = spansMultipleInboxes(calendars);
    return calendars.map((calendar) => ({
      id: calendar.id,
      name: calendarDisplayLabel(calendar, spansInboxes),
      color: calendar.color ?? DEFAULT_CALENDAR_SOURCE.color,
      emailAddress: calendar.emailAddress,
      isPrimary: calendar.isPrimary,
    }));
  });
  const sourceById = createMemo(
    () => new Map(sources().map((source) => [source.id, source]))
  );

  return { calendarsQuery, sourceById, sources };
}
