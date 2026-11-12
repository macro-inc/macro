import { TZDate } from '@date-fns/tz';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import type { EventTime } from '@service-storage/generated/schemas/eventTime';

const DAY = 86_400_000;

function eventTimeZone(...times: EventTime[]): string {
  for (const time of times) {
    if (time.kind === 'timed' && time.timeZone) return time.timeZone;
  }
  return 'UTC';
}

function wallInstant(instant: string, zone: string): number {
  const date = new TZDate(instant, zone);
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

function instantAtWall(wall: number, zone: string): string | undefined {
  if (!Number.isFinite(wall)) return;
  const date = new Date(wall);
  const zoned = new TZDate(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
    zone
  );
  if (!Number.isFinite(zoned.getTime())) return;
  const instant = new Date(zoned.getTime()).toISOString();
  // TZDate normalizes nonexistent local times forward; do not project a DST gap.
  if (wallInstant(instant, zone) !== wall) return;
  return instant;
}

function wallRange(time: EventTime, zone: string): readonly [number, number] {
  if (time.kind === 'allDay') {
    return [Date.parse(time.startDate), Date.parse(time.endDate)];
  }
  return [wallInstant(time.startsAt, zone), wallInstant(time.endsAt, zone)];
}

/** Project the start and end independently in the original master's wall-clock zone. */
export function shiftCalendarEventTime(
  time: EventTime,
  fromMaster: EventTime,
  toMaster: EventTime
): EventTime | undefined {
  if (time.kind !== fromMaster.kind || time.kind !== toMaster.kind) return;
  const zone = eventTimeZone(fromMaster, toMaster, time);
  try {
    const [fromStart, fromEnd] = wallRange(fromMaster, zone);
    const [toStart, toEnd] = wallRange(toMaster, zone);
    const [start, end] = wallRange(time, zone);
    if (
      ![fromStart, fromEnd, toStart, toEnd, start, end].every(
        Number.isFinite
      ) ||
      fromEnd <= fromStart ||
      toEnd <= toStart ||
      end <= start
    )
      return;
    const shiftedStart = start + toStart - fromStart;
    const shiftedEnd = end + toEnd - fromEnd;
    if (
      !Number.isFinite(shiftedStart) ||
      !Number.isFinite(shiftedEnd) ||
      shiftedEnd <= shiftedStart
    )
      return;

    if (time.kind === 'allDay') {
      if (shiftedStart % DAY !== 0 || shiftedEnd % DAY !== 0) return;
      return {
        kind: 'allDay',
        startDate: new Date(shiftedStart).toISOString().slice(0, 10),
        endDate: new Date(shiftedEnd).toISOString().slice(0, 10),
      };
    }
    const startsAt =
      shiftedStart === start
        ? time.startsAt
        : instantAtWall(shiftedStart, zone);
    const endsAt =
      shiftedEnd === end ? time.endsAt : instantAtWall(shiftedEnd, zone);
    if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt))
      return;
    return {
      ...time,
      startsAt,
      endsAt,
      timeZone:
        toMaster.kind === 'timed'
          ? (toMaster.timeZone ?? time.timeZone)
          : time.timeZone,
    };
  } catch {
    // Invalid time zones, dates, and out-of-range instants cannot be projected.
    return;
  }
}

/** Keep the cached occurrence identity while projecting an ordinary series instance. */
export function projectCalendarOccurrenceTime(
  item: CalendarOccurrenceItem,
  nextMaster: EventTime
): CalendarOccurrenceItem {
  const { event, occurrence } = item;
  const updatedEvent = { ...event, time: nextMaster };
  const recurrenceId = occurrence.recurrenceId;
  if (
    event.recurrenceLines.length === 0 &&
    !recurrenceId &&
    !occurrence.isCancelled
  ) {
    return {
      ...item,
      event: updatedEvent,
      occurrence: { ...occurrence, time: nextMaster },
    };
  }
  if (
    occurrence.isCancelled ||
    !recurrenceId ||
    occurrence.time.kind !== event.time.kind
  ) {
    return { ...item, event: updatedEvent };
  }

  const zone = eventTimeZone(event.time, nextMaster, occurrence.time);
  try {
    const [masterStart, masterEnd] = wallRange(event.time, zone);
    const [start, end] = wallRange(occurrence.time, zone);
    const originalStart =
      occurrence.time.kind === 'timed'
        ? wallInstant(recurrenceId, zone)
        : Date.parse(recurrenceId);
    // A moved or resized instance owns its time; keep it and its recurrence id.
    if (
      !Number.isFinite(originalStart) ||
      start !== originalStart ||
      (occurrence.time.kind === 'timed' &&
        Date.parse(recurrenceId) !== Date.parse(occurrence.time.startsAt)) ||
      end - start !== masterEnd - masterStart
    )
      return { ...item, event: updatedEvent };

    const time = shiftCalendarEventTime(
      occurrence.time,
      event.time,
      nextMaster
    );
    if (!time) return { ...item, event: updatedEvent };
    const nextRecurrenceId =
      time.kind === 'timed'
        ? occurrence.time.kind === 'timed' &&
          Date.parse(time.startsAt) === Date.parse(occurrence.time.startsAt)
          ? recurrenceId
          : new Date(time.startsAt)
              .toISOString()
              .replace(/(\.000)?Z$/, '+00:00')
        : occurrence.time.kind === 'allDay' &&
            time.startDate === occurrence.time.startDate
          ? recurrenceId
          : time.startDate;
    return {
      ...item,
      event: updatedEvent,
      occurrence: { ...occurrence, time, recurrenceId: nextRecurrenceId },
    };
  } catch {
    return { ...item, event: updatedEvent };
  }
}
