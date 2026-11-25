import type { DateTimeRangeValue } from '@app/components/date-time-range/time-range';
import { parseLocalDate } from '@core/util/local-date';
import { TZDateMini } from '@date-fns/tz';
import type { EventTime } from '@service-calendar/generated/schemas/eventTime';

export function isValidComposerTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

function zonedInstant(
  value: string,
  timeZone: string,
  nextDay: boolean
): string | undefined {
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value);
  const localDate = parseLocalDate(value.slice(0, 10));
  if (!parts || !localDate) return undefined;
  if (nextDay) localDate.setDate(localDate.getDate() + 1);
  const hours = Number(parts[4] ?? 0);
  const minutes = Number(parts[5] ?? 0);
  const date = new TZDateMini(
    localDate.getFullYear(),
    localDate.getMonth(),
    localDate.getDate(),
    hours,
    minutes,
    0,
    0,
    timeZone
  );
  if (!Number.isFinite(date.getTime())) return undefined;

  // Reject nonexistent local dates and DST-gap times instead of silently moving the event.
  const sameDate =
    date.getFullYear() === localDate.getFullYear() &&
    date.getMonth() === localDate.getMonth() &&
    date.getDate() === localDate.getDate();
  const sameTime = date.getHours() === hours && date.getMinutes() === minutes;
  if (!sameDate || !sameTime) return undefined;
  return date.toISOString();
}

/** Project the editor's wall-clock range into grid instants in its chosen zone. */
export function composerRangeInstants(
  range: DateTimeRangeValue,
  timeZone: string
): { start: Date; end: Date } | undefined {
  if (range.allDay || !isValidComposerTimeZone(timeZone)) return undefined;
  const start = zonedInstant(range.start, timeZone, false);
  const end = zonedInstant(range.end, timeZone, false);
  if (!start || !end || Date.parse(end) <= Date.parse(start)) return undefined;
  return { start: new Date(start), end: new Date(end) };
}

/** An explicit zone choice keeps the shown wall-clock fields and changes their instants. */
export function withComposerTimeZone(
  time: EventTime,
  range: DateTimeRangeValue,
  timeZone: string
): EventTime | undefined {
  if (time.kind === 'allDay') return time;
  if (!isValidComposerTimeZone(timeZone)) return undefined;
  const startsAt = zonedInstant(range.start, timeZone, false);
  const endsAt = zonedInstant(range.end, timeZone, range.allDay);
  if (!startsAt || !endsAt) return undefined;
  const duration = Date.parse(endsAt) - Date.parse(startsAt);
  const isImportedPoint = Date.parse(time.startsAt) === Date.parse(time.endsAt);
  if (duration < 0 || (duration === 0 && !isImportedPoint)) return undefined;
  return { ...time, startsAt, endsAt, timeZone };
}
