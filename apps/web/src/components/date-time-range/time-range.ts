import { formatLocalDate, parseLocalDate } from '@core/util/local-date';
import {
  addDays,
  addMinutes,
  differenceInCalendarDays,
  differenceInMinutes,
  format,
  isValid,
  parseISO,
} from 'date-fns';

/** `<input type="datetime-local">` value. */
const DATETIME_VALUE = "yyyy-MM-dd'T'HH:mm";

/**
 * A range as `DateTimeRangeFields` edits it: each end a `YYYY-MM-DD` day when
 * all day, the end day included, otherwise a local `YYYY-MM-DDTHH:mm`. An
 * unset end is empty.
 */
export interface DateTimeRangeValue {
  allDay: boolean;
  start: string;
  end: string;
}

/**
 * A time range held as dates. An all-day range spans the local days `start`
 * to `end`, both included, each at local midnight; a timed range runs from
 * the instant `start` to the instant `end`.
 */
export interface TimeRange {
  allDay: boolean;
  start: Date;
  end: Date;
}

/** No range yet: an all-day range with neither end picked. */
export const EMPTY_DATE_TIME_RANGE: DateTimeRangeValue = {
  allDay: true,
  start: '',
  end: '',
};

/** The fields' value for `range`. */
export function dateTimeRangeValue(range: TimeRange): DateTimeRangeValue {
  if (range.allDay)
    return {
      allDay: true,
      start: formatLocalDate(range.start),
      end: formatLocalDate(range.end),
    };
  return {
    allDay: false,
    start: format(range.start, DATETIME_VALUE),
    end: format(range.end, DATETIME_VALUE),
  };
}

function parseLocalDateTime(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const date = new Date(value);
  return isValid(date) ? date : undefined;
}

/**
 * The range the fields hold once both ends are set, in whatever order they
 * were picked: a caller checks that it does not end before it starts.
 */
export function timeRangeFromValue(
  value: DateTimeRangeValue
): TimeRange | undefined {
  const parse = value.allDay ? parseLocalDate : parseLocalDateTime;
  const start = parse(value.start);
  const end = parse(value.end);
  return start && end ? { allDay: value.allDay, start, end } : undefined;
}

/**
 * Moves an all-day range's end with its start, keeping its number of days. A
 * range with no end yet becomes the start's day alone.
 */
export function moveAllDayRange<Range extends { start: string; end: string }>(
  range: Range,
  nextStart: string
): Range {
  if (nextStart === '') return { ...range, start: '', end: '' };
  const duration = differenceInCalendarDays(
    parseISO(range.end),
    parseISO(range.start)
  );
  const durationDays = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  return {
    ...range,
    start: nextStart,
    end: format(addDays(parseISO(nextStart), durationDays), 'yyyy-MM-dd'),
  };
}

/**
 * Moves a timed range's end with its start, keeping the duration, as Google
 * Calendar does. A range with no positive duration (incomplete, or already
 * ending before it starts) keeps its end, since there is nothing to keep.
 */
export function moveTimedRange<Range extends { start: string; end: string }>(
  range: Range,
  nextStart: string
): Range {
  const start = parseISO(nextStart);
  const duration = differenceInMinutes(
    parseISO(range.end),
    parseISO(range.start)
  );
  if (!isValid(start) || !Number.isFinite(duration) || duration <= 0) {
    return { ...range, start: nextStart };
  }
  return {
    ...range,
    start: nextStart,
    end: format(addMinutes(start, duration), DATETIME_VALUE),
  };
}

/**
 * The fields once All day turns on or off. Turning it on keeps each end's
 * day. Turning it off gives the start the next full hour after `now`, as a
 * new calendar event gets, and the end an hour later on the end's own day; a
 * range with no days yet starts on `now`'s.
 */
export function withAllDay(
  value: DateTimeRangeValue,
  allDay: boolean,
  now = new Date()
): DateTimeRangeValue {
  if (allDay === value.allDay) return value;
  if (allDay)
    return {
      allDay,
      start: value.start.slice(0, 10),
      end: value.end.slice(0, 10),
    };
  const startDay = parseLocalDate(value.start) ?? now;
  const endDay = parseLocalDate(value.end) ?? startDay;
  const hour = (now.getHours() + 1) % 24;
  const at = (day: Date, hours: number) =>
    format(
      new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours),
      DATETIME_VALUE
    );
  return { allDay, start: at(startDay, hour), end: at(endDay, hour + 1) };
}
