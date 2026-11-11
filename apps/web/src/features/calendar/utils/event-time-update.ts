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

function instantFromWallTime(
  value: number,
  timeZone: string,
  originalInstant?: string
) {
  if (originalInstant && wallTime(originalInstant, timeZone) === value) {
    return new Date(originalInstant).toISOString();
  }
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
  const instant = new Date(zoned.getTime()).toISOString();
  // A gap has no instant; a fold has two. Do not silently choose a different
  // series time than the one the user dropped. The single-occurrence API keeps
  // the exact instant and remains available in either case.
  const ambiguous = [-1, 1].some((day) => {
    const offset = new TZDate(
      zoned.getTime() + day * 86_400_000,
      timeZone
    ).getTimezoneOffset();
    const alternative = value + offset * 60_000;
    return (
      alternative !== zoned.getTime() &&
      wallTime(new Date(alternative).toISOString(), timeZone) === value
    );
  });
  if (wallTime(instant, timeZone) !== value || ambiguous) {
    throw new Error(
      'The series time crosses a daylight-saving transition. Choose This event.'
    );
  }
  return instant;
}
function wallRange(time: EventTime, fallbackZone: string) {
  if (time.kind === 'allDay') {
    return [Date.parse(time.startDate), Date.parse(time.endDate)] as const;
  }
  return [
    wallTime(time.startsAt, fallbackZone),
    wallTime(time.endsAt, fallbackZone),
  ] as const;
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
  const zone =
    (time.kind === 'timed' ? time.timeZone : undefined) ??
    event.timeZone ??
    (master.kind === 'timed' ? master.timeZone : undefined) ??
    Intl.DateTimeFormat().resolvedOptions().timeZone;
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
  // Validate the dropped instants too: a series rule cannot encode a choice
  // between the two instants in a repeated local hour.
  if (time.kind === 'timed') {
    if (
      before.kind !== 'timed' ||
      Date.parse(before.startsAt) !== Date.parse(time.startsAt)
    ) {
      instantFromWallTime(newStart, zone);
    }
    if (
      before.kind !== 'timed' ||
      Date.parse(before.endsAt) !== Date.parse(time.endsAt)
    ) {
      instantFromWallTime(newEnd, zone);
    }
  }
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
          startsAt: instantFromWallTime(
            start,
            time.timeZone ?? zone,
            master.kind === 'timed' ? master.startsAt : undefined
          ),
          endsAt: instantFromWallTime(
            end,
            time.timeZone ?? zone,
            master.kind === 'timed' ? master.endsAt : undefined
          ),
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
