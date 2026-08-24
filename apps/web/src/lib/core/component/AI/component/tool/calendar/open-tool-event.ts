import type { CalendarBlockEventTime } from '@block-calendar/calendar-range';
import { openCalendarEventSplit } from '@block-calendar/open-calendar-event';
import type { NamedTool } from '@service-cognition/generated/tools/tool';

/** The event shape the create and update calendar tools return. */
export type ToolCalendarEvent = NamedTool<
  'UpdateCalendarEvent',
  'response'
>['data'];

type OpenToolCalendarEventOptions = {
  /** Instance to aim at, when the call targeted one occurrence of a series. */
  occurrenceKey?: string;
  /**
   * Locator timing to use instead of the event's own. An occurrence-scoped
   * call returns the refreshed series, whose start is the master's rather
   * than the occurrence's.
   */
  time?: CalendarBlockEventTime;
};

function eventTime(event: ToolCalendarEvent): CalendarBlockEventTime {
  return event.isAllDay
    ? { kind: 'allDay', startDate: event.start, endDate: event.end }
    : { kind: 'timed', startsAt: event.start, endsAt: event.end };
}

/** Time fields of a tool time input, as calendar navigation expects them. */
export function toolInputOpenTime(
  time: NonNullable<NamedTool<'UpdateCalendarEvent', 'call'>['data']['time']>
): CalendarBlockEventTime {
  return time.kind === 'allDay'
    ? { kind: 'allDay', startDate: time.startDate, endDate: time.endDate }
    : { kind: 'timed', startsAt: time.startsAt, endsAt: time.endsAt };
}

/**
 * Open the calendar aimed at an event a calendar tool returned, the same way
 * clicking an event mention does.
 */
export function openToolCalendarEvent(
  event: ToolCalendarEvent,
  options?: OpenToolCalendarEventOptions
) {
  const occurrenceKey = options?.occurrenceKey;
  openCalendarEventSplit({
    eventId: event.eventId,
    occurrenceKey,
    // An occurrence key anchors the locator range on its own, so the event's
    // own timing only stands in for calls that were not occurrence-scoped.
    time: options?.time ?? (occurrenceKey ? undefined : eventTime(event)),
  });
}
