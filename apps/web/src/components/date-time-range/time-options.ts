import { formatLocalDate, parseLocalDate } from '@core/util/local-date';
import { addDays, differenceInCalendarDays } from 'date-fns';
import { minutesInDay, minutesInHour } from 'date-fns/constants';

/** Granularity of every time picker. */
const SLOT_MINUTES = 15;

/**
 * Longest range the end picker offers, matching Google Calendar: one slot
 * short of a full day, so a same-start end time is never listed twice.
 */
const MAX_RANGE_MINUTES = minutesInDay - SLOT_MINUTES;

const timeLabelFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

/** One selectable clock time in a time picker. */
export interface TimeOption {
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

/** `30min`, `1h`, `1h 15min` — Google Calendar's compact duration. */
export function formatDuration(minutes: number): string {
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
export const DAY_TIME_OPTIONS: TimeOption[] = Array.from(
  { length: minutesInDay / SLOT_MINUTES },
  (_, index) => timeOption(index * SLOT_MINUTES, 0)
);

/**
 * Quarter-hours from 15 minutes to 23h45min after `startTime`, each labelled
 * with the duration it produces. Options past midnight carry the day offset
 * they land on, so the end date follows the chosen time.
 */
export function endTimeOptions(startTime: string): TimeOption[] {
  const startMinutes = parseTimeValue(startTime);
  if (startMinutes === undefined) return DAY_TIME_OPTIONS;

  const options: TimeOption[] = [];
  for (
    let duration = SLOT_MINUTES;
    duration <= MAX_RANGE_MINUTES;
    duration += SLOT_MINUTES
  ) {
    const total = startMinutes + duration;
    options.push(
      timeOption(
        total % minutesInDay,
        Math.floor(total / minutesInDay),
        formatDuration(duration)
      )
    );
  }
  return options;
}

/** The option a picker highlights for the value it currently holds. */
export function selectedTimeOptionId(value: string, dayOffset = 0) {
  return optionId(dayOffset, value);
}

function normalizeTyped(text: string) {
  return text.toLowerCase().replace(/[\s.]/g, '');
}

/**
 * Clock times a typed entry can mean, in minutes past midnight: `3` is 3 AM
 * or 3 PM, while `3p`, `3:30pm`, `330` and `15:30` name one each. Empty when
 * the entry is no clock time (yet).
 */
export function typedTimeCandidates(text: string): number[] {
  const typed = normalizeTyped(text);
  if (typed === 'noon') return [12 * minutesInHour];
  if (typed === 'midnight') return [0];
  const match = /^(\d{1,2})(?:[:h]?(\d{2}))?(am?|pm?)?$/.exec(typed);
  if (!match) return [];
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3];
  if (minute >= minutesInHour) return [];
  if (meridiem) {
    if (hour < 1 || hour > 12) return [];
    const afternoon = meridiem.startsWith('p') ? 12 : 0;
    return [((hour % 12) + afternoon) * minutesInHour + minute];
  }
  if (hour > 23) return [];
  if (hour === 0 || hour > 12) return [hour * minutesInHour + minute];
  return [
    (hour % 12) * minutesInHour + minute,
    ((hour % 12) + 12) * minutesInHour + minute,
  ];
}

/**
 * The option to highlight while a time is typed: the first listed time the
 * entry names (the list's order settles AM or PM, so an end lands soonest
 * after its start), else the first whose label or 24-hour value it begins.
 * A complete time that no option lists matches nothing.
 */
export function matchTypedTime(
  options: TimeOption[],
  text: string
): TimeOption | undefined {
  const candidates = typedTimeCandidates(text).map(timeValue);
  const named = options.find((option) => candidates.includes(option.value));
  if (named) return named;
  const typed = normalizeTyped(text);
  if (!typed || candidates.length > 0) return undefined;
  return options.find(
    (option) =>
      normalizeTyped(option.label).startsWith(typed) ||
      option.value.startsWith(typed)
  );
}

/**
 * The option a typed entry commits to: its match, else the exact time typed
 * (the reading soonest after the list's first option), on the anchor day.
 */
export function typedTimeOption(
  options: TimeOption[],
  text: string
): TimeOption | undefined {
  const matched = matchTypedTime(options, text);
  if (matched) return matched;
  const first = parseTimeValue(options[0]?.value ?? '') ?? 0;
  const after = (minutes: number) =>
    (minutes - first + minutesInDay) % minutesInDay;
  const [soonest] = typedTimeCandidates(text).sort(
    (left, right) => after(left) - after(right)
  );
  return soonest === undefined ? undefined : timeOption(soonest, 0);
}

/**
 * The text a time field shows while typing: `option`'s label when the entry
 * begins it, so the rest fills in, else `undefined`.
 */
export function completedTypedTime(
  text: string,
  option: TimeOption | undefined
): string | undefined {
  if (!option || !text || option.label.length <= text.length) return undefined;
  const spaced = (value: string) => value.toLowerCase().replace(/\s/g, ' ');
  return spaced(option.label).startsWith(spaced(text))
    ? option.label
    : undefined;
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
  return elapsed <= MAX_RANGE_MINUTES;
}

/**
 * The end value an end-time option resolves to, relative to `start`. A clock
 * time that would land at or before the start rolls into the following day:
 * the picker lists no such option, so this only ever describes a time typed
 * by hand, and an end before its own start is never what the typing meant.
 */
export function endValueFor(
  start: string,
  option: Pick<TimeOption, 'value' | 'dayOffset'>
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
