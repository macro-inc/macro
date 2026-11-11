import { TZDate } from '@date-fns/tz';
import type { UpdateCalendarEventArgs } from '@queries/calendar/mutations';
import type { EventTime } from '@service-calendar/generated/schemas/eventTime';
import type { CalendarUpdateScope } from '@service-email/client';
import type { CalendarEvent } from '../types';
import { isRecurringCalendarEvent } from './event-interaction';
import { shiftRecurrenceDays } from './shift-recurrence';

/** The same occurrence addressing is used by the editor and grid interactions. */
export function calendarEventUpdateTarget(
  event: CalendarEvent,
  scope: CalendarUpdateScope
) {
  const single = scope === 'this_event';
  return {
    eventId: event.eventId,
    calendarId: event.calendarId,
    scope,
    recurrenceId: single
      ? (event.recurrenceId ?? event.occurrenceKey)
      : undefined,
    occurrenceKey: single ? event.occurrenceKey : undefined,
  };
}

function wallTime(instant: string, timeZone: string) {
  const date = new TZDate(instant, timeZone);
  return Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  );
}

function instantFromWallTime(value: number, timeZone: string) {
  const date = new Date(value);
  const zoned = new TZDate(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
    timeZone
  );
  return new Date(zoned.getTime()).toISOString();
}
function wallRange(time: EventTime, fallbackZone: string) {
  if (time.kind === 'allDay') {
    return [Date.parse(time.startDate), Date.parse(time.endDate)] as const;
  }
  const zone = time.timeZone ?? fallbackZone;
  return [wallTime(time.startsAt, zone), wallTime(time.endsAt, zone)] as const;
}

/**
 * Apply the occurrence's wall-clock deltas to the master, not its absolute date.
 * Wall time preserves the series' clock time when the dragged week crosses DST.
 * Separate start/end deltas preserve both moves and either resize handle.
 */
export function calendarEventTimeUpdate(
  event: CalendarEvent,
  time: EventTime,
  scope: CalendarUpdateScope
): UpdateCalendarEventArgs {
  const target = calendarEventUpdateTarget(event, scope);
  if (scope === 'this_event' || !isRecurringCalendarEvent(event)) {
    return { ...target, patch: { time } };
  }
  const master = event.seriesTime;
  if (!master)
    throw new Error('The repeating event must be reloaded before editing.');
  const zone = event.timeZone ?? 'UTC';
  const before: EventTime = event.allDay
    ? { kind: 'allDay', startDate: event.start, endDate: event.end }
    : {
        kind: 'timed',
        startsAt: event.start,
        endsAt: event.end,
        timeZone: zone,
      };
  const [oldStart, oldEnd] = wallRange(before, zone);
  const [newStart, newEnd] = wallRange(time, zone);
  const [masterStart, masterEnd] = wallRange(master, zone);
  const originalStart = event.recurrenceId ?? event.occurrenceKey;
  const movedException = Date.parse(originalStart) !== Date.parse(event.start);
  const resizedException = oldEnd - oldStart !== masterEnd - masterStart;
  if (movedException || resizedException) {
    throw new Error(
      'This occurrence has its own time. Choose This event to change it.'
    );
  }
  const start = masterStart + newStart - oldStart;
  const end = masterEnd + newEnd - oldEnd;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error('The repeating event must keep a positive duration.');
  }
  const updated: EventTime =
    time.kind === 'allDay'
      ? {
          kind: 'allDay',
          startDate: new Date(start).toISOString().slice(0, 10),
          endDate: new Date(end).toISOString().slice(0, 10),
        }
      : {
          kind: 'timed',
          startsAt: instantFromWallTime(start, time.timeZone ?? zone),
          endsAt: instantFromWallTime(end, time.timeZone ?? zone),
          timeZone: time.timeZone ?? zone,
        };
  const days =
    Math.floor(start / 86_400_000) - Math.floor(masterStart / 86_400_000);
  const recurrenceLines = shiftRecurrenceDays(
    event.recurrenceLines,
    days,
    start !== masterStart
  );
  if (!recurrenceLines) {
    throw new Error(
      'Moving all events is not supported for this repeat pattern. Choose This event.'
    );
  }
  const recurrenceChanged = recurrenceLines.some(
    (line, index) => line !== event.recurrenceLines[index]
  );
  return {
    ...target,
    patch: { time: updated, ...(recurrenceChanged ? { recurrenceLines } : {}) },
  };
}
