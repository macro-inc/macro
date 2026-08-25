import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import type { Accessor } from 'solid-js';

/**
 * Whether the channel input may offer the event compose mode: the calendar
 * UI flag is on and the viewer has at least one writable calendar to create
 * events on. Without either, the Event switch stays hidden entirely — there
 * is nowhere to put an event.
 */
export function createEventModeAvailability(): Accessor<boolean> {
  const calendarUiEnabled = useCalendarUiFlag();
  const calendarsQuery = useVisibleCalendarsQuery(() => ({
    enabled: calendarUiEnabled(),
  }));
  return () =>
    calendarUiEnabled() &&
    (calendarsQuery.data?.some((calendar) => calendar.isWritable) ?? false);
}
