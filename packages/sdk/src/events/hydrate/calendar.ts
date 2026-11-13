import { CalendarEvent } from '../../entities/calendar/event';
import type { MacroClient } from '../../utils/client';
import type { MacroEvent } from '../types';

export type CalendarChangeEvent = Extract<
  MacroEvent,
  { event_type: `calendar_event.${string}` }
>;

/** Attach the calendar event handle to a calendar change. */
export function hydrateCalendarEvent(
  client: MacroClient,
  event: CalendarChangeEvent,
) {
  return {
    event_type: event.event_type,
    metadata: event.metadata,
    calendarEvent: CalendarEvent.byId(client, event.metadata.event_id),
  };
}
