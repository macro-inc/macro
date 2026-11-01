import type { AvailabilityCalendar } from '@service-calendar/generated/schemas/availabilityCalendar';
import {
  type CalendarSource,
  DEFAULT_CALENDAR_SOURCE,
} from '../../calendar/types';

/**
 * The calendars that can count toward availability, presented like the
 * sidebar's sources: the viewer's own sources in their order and colors, then
 * any the source list does not know yet.
 */
export function availabilitySources(
  sources: readonly CalendarSource[],
  calendars: readonly AvailabilityCalendar[]
): CalendarSource[] {
  const calendarIds = new Set(calendars.map((calendar) => calendar.calendarId));
  const known = sources.filter((source) => calendarIds.has(source.id));
  const knownIds = new Set(known.map((source) => source.id));
  return [
    ...known,
    ...calendars
      .filter((calendar) => !knownIds.has(calendar.calendarId))
      .map((calendar) => ({
        id: calendar.calendarId,
        name: calendar.name,
        color: DEFAULT_CALENDAR_SOURCE.color,
        isPrimary: calendar.isPrimary,
      })),
  ];
}
