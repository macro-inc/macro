import { addDays, differenceInCalendarDays } from 'date-fns';
import { minutesInDay, minutesInHour } from 'date-fns/constants';
import { formatLocalDate, parseLocalDate } from '../../utils/calendar-date';

/** Granularity of every event time picker. */
const SLOT_MINUTES = 15;

/**
 * Longest event the end picker offers, matching Google Calendar: one slot
 * short of a full day, so a same-start end time is never listed twice.
 */
const MAX_EVENT_MINUTES = minutesInDay - SLOT_MINUTES;

const timeLabelFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

/** One selectable clock time in an event time picker. */
export interface EventTimeOption {
  /** Listbox key, distinguishing clock times that land on different days. */
  id: string;
  /** Canonical `HH:mm` value. */
  value: string;
  /** Localized clock label. */
  label: string;
  /** Days past the picker's anchor date this option lands on. */
  dayOffset: number;
  /** Muted trailing text, e.g. the duration the option produces. */
  detail?: string;
}

function optionId(dayOffset: number, value: string) {
  return `${dayOffset}|${value}`;
}

function timeValue(minutesOfDay: number) {
  const hour = Math.floor(minutesOfDay / minutesInHour);
  const minute = minutesOfDay % minutesInHour;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Minutes past midnight of an `HH:mm` value, or `undefined` when unparsable. */
export function parseTimeValue(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return hour * minutesInHour + minute;
}

/** Localized clock label for an `HH:mm` value. */
export function formatTimeValue(value: string): string | undefined {
  const minutesOfDay = parseTimeValue(value);
  if (minutesOfDay === undefined) return undefined;
  return timeLabelFormatter.format(
    new Date(
      2000,
      0,
      1,
      Math.floor(minutesOfDay / minutesInHour),
      minutesOfDay % minutesInHour
    )
  );
}

/** `30min`, `1h`, `1h 15min` — Google's compact event duration. */
export function formatEventDuration(minutes: number): string {
  const hours = Math.floor(minutes / minutesInHour);
  const remainder = minutes % minutesInHour;
  if (hours === 0) return `${remainder}min`;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}min`;
}

function timeOption(minutesOfDay: number, dayOffset: number, detail?: string) {
  const value = timeValue(minutesOfDay);
  return {
    id: optionId(dayOffset, value),
    value,
    label: formatTimeValue(value) ?? value,
    dayOffset,
    ...(detail ? { detail } : {}),
  };
}

/** Every quarter-hour in a day, used wherever no start anchors the choice. */
export const DAY_TIME_OPTIONS: EventTimeOption[] = Array.from(
  { length: minutesInDay / SLOT_MINUTES },
  (_, index) => timeOption(index * SLOT_MINUTES, 0)
);

/**
 * Quarter-hours from 15 minutes to 23h45min after `startTime`, each labelled
 * with the duration it produces. Options past midnight carry the day offset
 * they land on, so the end date follows the chosen time.
 */
export function endTimeOptions(startTime: string): EventTimeOption[] {
  const startMinutes = parseTimeValue(startTime);
  if (startMinutes === undefined) return DAY_TIME_OPTIONS;

  const options: EventTimeOption[] = [];
  for (
    let duration = SLOT_MINUTES;
    duration <= MAX_EVENT_MINUTES;
    duration += SLOT_MINUTES
  ) {
    const total = startMinutes + duration;
    options.push(
      timeOption(
        total % minutesInDay,
        Math.floor(total / minutesInDay),
        formatEventDuration(duration)
      )
    );
  }
  return options;
}

/** The option a picker highlights for the value it currently holds. */
export function selectedTimeOptionId(value: string, dayOffset = 0) {
  return optionId(dayOffset, value);
}

/** The option a typed clock time resolves to within `options`. */
export function resolveTimeOption(
  options: EventTimeOption[],
  time: string
): EventTimeOption {
  return (
    options.find((option) => option.value === time) ?? {
      id: optionId(0, time),
      value: time,
      label: formatTimeValue(time) ?? time,
      dayOffset: 0,
    }
  );
}

export function splitLocalDateTime(value: string) {
  const separator = value.indexOf('T');
  if (separator === -1) return { date: value, time: '' };
  return {
    date: value.slice(0, separator),
    time: value.slice(separator + 1, separator + 6),
  };
}

export function withLocalDate(value: string, date: string) {
  return `${date}T${splitLocalDateTime(value).time}`;
}

export function withLocalTime(value: string, time: string) {
  return `${splitLocalDateTime(value).date}T${time}`;
}

/** Whole days between two `datetime-local` values, counted by calendar date. */
export function dayOffsetBetween(from: string, to: string) {
  const fromDate = parseLocalDate(splitLocalDateTime(from).date);
  const toDate = parseLocalDate(splitLocalDateTime(to).date);
  if (!fromDate || !toDate) return 0;
  return differenceInCalendarDays(toDate, fromDate);
}

/**
 * Whether an end value is close enough to `start` to be described as a
 * duration. Longer spans keep their own end date: their options are plain
 * clock times, since no single day's list can reach them.
 */
export function withinEndTimeWindow(start: string, end: string) {
  const startTime = parseTimeValue(splitLocalDateTime(start).time);
  const endTime = parseTimeValue(splitLocalDateTime(end).time);
  if (startTime === undefined || endTime === undefined) return false;
  const elapsed =
    dayOffsetBetween(start, end) * minutesInDay + endTime - startTime;
  return elapsed <= MAX_EVENT_MINUTES;
}

/**
 * The end value an end-time option resolves to, relative to `start`. A clock
 * time that would land at or before the start rolls into the following day:
 * the picker lists no such option, so this only ever describes a time typed
 * by hand, and an end before its own start is never what the typing meant.
 */
export function endValueFor(
  start: string,
  option: Pick<EventTimeOption, 'value' | 'dayOffset'>
) {
  const { date, time } = splitLocalDateTime(start);
  const startDate = parseLocalDate(date);
  if (!startDate) return withLocalTime(start, option.value);

  const startMinutes = parseTimeValue(time);
  const optionMinutes = parseTimeValue(option.value);
  const rollsOver =
    option.dayOffset === 0 &&
    startMinutes !== undefined &&
    optionMinutes !== undefined &&
    optionMinutes <= startMinutes;

  const dayOffset = rollsOver ? 1 : option.dayOffset;
  return `${formatLocalDate(addDays(startDate, dayOffset))}T${option.value}`;
}
