import { formatDuration } from '@app/components/date-time-range/time-options';
import { useCalendarPreferences } from '@app/features/calendar/utils/preferences';
import {
  formatCompactCalendarTime,
  formatCompactCalendarTimeRange,
} from '@app/features/calendar/utils/time-format';
import {
  addDays,
  addHours,
  addMinutes,
  differenceInCalendarDays,
  differenceInMinutes,
  endOfDay,
  isSameDay,
  startOfDay,
  startOfHour,
} from 'date-fns';
import { SYSTEM_PROPERTY_IDS } from '../identifiers';
import type { Property } from '../types';
import { isDateProperty } from './typeGuards';

/** Which end of a task's or project's dates the picker sets. */
export type DateField = 'start' | 'due';

/**
 * A task's or project's Start Date and Due Date. Without `timed` each is a
 * whole local day; with it, each end is an exact moment with its time of day.
 */
export type StartDue = {
  start: Date | null;
  due: Date | null;
  timed?: boolean;
  /** With times, an end saved as a whole day, read without a time. */
  wholeDay?: DateField;
};

const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

const DAY_YEAR_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/**
 * The text a dates pill shows when a start is set: `Nov 23 → Nov 27`, the
 * year added once when it is not the current one and on both ends when they
 * differ, `Nov 23 →` without a due date, or the one date when both fall on
 * the same day. Without a start there is no range; the pill keeps the due
 * date's own text.
 */
export function formatStartDue(
  dates: StartDue,
  now = new Date()
): string | undefined {
  if (dates.timed) return formatTimedStartDue(dates, now);
  const { start, due } = dates;
  if (!start) return undefined;
  if (!due) {
    const format =
      start.getFullYear() === now.getFullYear() ? DAY_FORMAT : DAY_YEAR_FORMAT;
    return `${format.format(start)} →`;
  }
  if (isSameDay(start, due)) {
    const format =
      due.getFullYear() === now.getFullYear() ? DAY_FORMAT : DAY_YEAR_FORMAT;
    return format.format(due);
  }
  if (start.getFullYear() !== due.getFullYear()) {
    return `${DAY_YEAR_FORMAT.format(start)} → ${DAY_YEAR_FORMAT.format(due)}`;
  }
  const end =
    due.getFullYear() === now.getFullYear()
      ? DAY_FORMAT.format(due)
      : DAY_YEAR_FORMAT.format(due);
  return `${DAY_FORMAT.format(start)} → ${end}`;
}

/** Whether times read on a 12-hour clock, as the calendar shows them. */
export function clockIs12Hour(): boolean {
  const [preferences] = useCalendarPreferences();
  return preferences.timeFormat === '12-hour';
}

function dayTimeFormat(withYear: boolean) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
    hour12: clockIs12Hour(),
  });
}

/**
 * The text for dates with times: `Nov 26, 2:00 – 4:00 PM` on one day,
 * `Nov 26, 2:00 PM → Nov 28, 4:00 PM` across days, `Nov 26, 2:00 PM →`
 * without a due date and `Nov 26, 4:00 PM` without a start.
 */
function formatTimedStartDue(dates: StartDue, now: Date): string | undefined {
  const text = timedStartDueText(dates, now);
  // Intl puts narrow and thin spaces around times; plain ones read the same.
  return text?.replace(/[\u2009\u202f]/g, ' ');
}

function timedStartDueText(dates: StartDue, now: Date): string | undefined {
  const { start, due, wholeDay } = dates;
  const thisYear = (date: Date) => date.getFullYear() === now.getFullYear();
  const text = (end: DateField, date: Date, withYear: boolean) =>
    wholeDay === end
      ? (withYear ? DAY_YEAR_FORMAT : DAY_FORMAT).format(date)
      : dayTimeFormat(withYear).format(date);
  if (!start) return due ? text('due', due, !thisYear(due)) : undefined;
  if (!due) return `${text('start', start, !thisYear(start))} →`;
  if (isSameDay(start, due)) {
    // A whole-day start on the due date's day adds nothing to read.
    if (wholeDay === 'start') return text('due', due, !thisYear(due));
    if (!wholeDay) {
      return dayTimeFormat(!thisYear(start)).formatRange(start, due);
    }
  }
  const withYear = !thisYear(start) || !thisYear(due);
  return `${text('start', start, withYear)} → ${text('due', due, withYear)}`;
}

/**
 * `formatStartDue` for a narrow list cell or card: times of day are compact,
 * as on a calendar event (`Nov 26, 2–4pm`, `Nov 26, 2pm`). A range across
 * days reads as its days alone (`Nov 26 → Nov 28`), as whole days do, since
 * both times do not fit; the pill and the picker show them.
 */
export function formatStartDueCompact(
  dates: StartDue,
  now = new Date()
): string | undefined {
  const { start, due, wholeDay } = dates;
  if (!dates.timed || (start && due && !isSameDay(start, due))) {
    return formatStartDue({ start, due }, now);
  }
  const clock = clockIs12Hour() ? '12-hour' : '24-hour';
  const withYear =
    (start && start.getFullYear() !== now.getFullYear()) ||
    (due && due.getFullYear() !== now.getFullYear());
  const day = (date: Date) =>
    (withYear ? DAY_YEAR_FORMAT : DAY_FORMAT).format(date);
  const at = (end: DateField, date: Date) =>
    wholeDay === end
      ? day(date)
      : `${day(date)}, ${formatCompactCalendarTime(date, clock)}`;
  if (!start) return due ? at('due', due) : undefined;
  if (!due) return `${at('start', start)} →`;
  if (wholeDay === 'start') return at('due', due);
  if (wholeDay === 'due') return `${at('start', start)} → ${day(due)}`;
  if (start.getTime() === due.getTime()) return at('due', due);
  return `${day(start)}, ${formatCompactCalendarTimeRange(start, due, clock)}`;
}

/**
 * The footer's length: `2h` or `1h 30min` for times within a day, else the
 * calendar days from start to due, both counted.
 */
export function startDueLength(dates: StartDue): string | undefined {
  const { start, due } = dates;
  if (!start || !due) return undefined;
  if (dates.timed) {
    const minutes = differenceInMinutes(due, start);
    if (minutes >= 0 && minutes < 24 * 60) return formatDuration(minutes);
  }
  const days = startDueDays(start, due);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * The dates once Add time turns times on, as a new calendar event gets them:
 * the start at the next full hour after `now` on its own day, and the due
 * date an hour after that on its day. A due date alone takes the next full
 * hour, and with neither end set the due date becomes that hour today.
 */
export function withTimes(dates: StartDue, now = new Date()): StartDue {
  const hour = (now.getHours() + 1) % 24;
  const start = dates.start ? atClock(dates.start, hour * 60) : null;
  if (!dates.due) {
    return { start, due: start ? null : nextFullHour(now), timed: true };
  }
  return {
    start,
    due: atClock(dates.due, (start ? hour + 1 : hour) * 60),
    timed: true,
  };
}

/** `day` at the local clock time `minutes` past its midnight, whatever DST does that day. */
function atClock(day: Date, minutes: number): Date {
  const at = new Date(day);
  at.setHours(0, minutes, 0, 0);
  return at;
}

function nextFullHour(now: Date): Date {
  return addHours(startOfHour(now), 1);
}

/** The dates once Remove time makes each end a whole day again. */
export function withoutTimes(dates: StartDue): StartDue {
  return {
    start: dates.start && startOfDay(dates.start),
    due: dates.due && startOfDay(dates.due),
  };
}

/**
 * The dates after a clock time is picked for `field`, as minutes past the
 * midnight of `day`. A new start time moves the due date with it, keeping
 * the length, as a calendar event's end follows its start. With no length to
 * keep (no start yet, a start after the due date, or an end saved without a
 * time), a start time past the due date moves the due date to it, and one
 * before it leaves the due date as it is. A due time before the start moves
 * the start back to it.
 */
export function pickTime(
  dates: StartDue,
  field: DateField,
  day: Date,
  minutes: number
): { dates: StartDue; changed: DateField[] } {
  const at = atClock(day, minutes);
  if (field === 'start') {
    const { start, due } = dates;
    if (start && due && due >= start && !dates.wholeDay) {
      return {
        dates: {
          ...dates,
          start: at,
          due: addMinutes(at, differenceInMinutes(due, start)),
        },
        changed: ['start', 'due'],
      };
    }
    if (due && at > due) {
      return {
        dates: { ...dates, start: at, due: at },
        changed: ['start', 'due'],
      };
    }
    return { dates: { ...dates, start: at }, changed: ['start'] };
  }
  if (dates.start && at < dates.start) {
    return {
      dates: { ...dates, start: at, due: at },
      changed: ['start', 'due'],
    };
  }
  return { dates: { ...dates, due: at }, changed: ['due'] };
}

/** One end a timeline drag saves: its new moment and whether it keeps a time. */
export type RescheduledEnd = {
  field: DateField;
  value: Date;
  hasTime: boolean;
};

/**
 * The saves a timeline drag makes from the range the bar was dropped at:
 * each end that changed (by day for whole days, by moment for times), the
 * due date first when the new start passes the saved due date, as the
 * server keeps a start on or before it. A bar drawn from the created date,
 * for a task with no start, gains a start only when its start moved. A timed
 * bar's `wholeDay` end, saved without a time, stays a whole day, held at the
 * same time of its new day (midnight, or the end of a day a suggestion picked)
 * so it never lands before a start on that day.
 */
export function rescheduledStartDue(
  previous: { start: Date; due: Date | null; wholeDay?: DateField },
  range: { start: Date; end: Date; allDay: boolean }
): RescheduledEnd[] {
  const wholeDay = (field: DateField) =>
    range.allDay || previous.wholeDay === field;
  const moved = (field: DateField, before: Date | null, after: Date) =>
    !before ||
    (wholeDay(field)
      ? !isSameDay(before, after)
      : before.getTime() !== after.getTime());
  const onDayOf = (before: Date | null, after: Date) =>
    before
      ? addDays(before, differenceInCalendarDays(after, before))
      : startOfDay(after);
  // A start without a time is held at the start of its new day, never after
  // a due date on it; a due date at the time of day it was held at.
  const heldOn = (field: DateField, before: Date | null, value: Date) =>
    field === 'start' ? startOfDay(value) : onDayOf(before, value);
  const end = (
    field: DateField,
    before: Date | null,
    value: Date
  ): RescheduledEnd => ({
    field,
    value:
      wholeDay(field) && !range.allDay ? heldOn(field, before, value) : value,
    hasTime: !wholeDay(field),
  });
  const ends: RescheduledEnd[] = [];
  if (moved('start', previous.start, range.start)) {
    ends.push(end('start', previous.start, range.start));
  }
  if (moved('due', previous.due, range.end)) {
    ends.push(end('due', previous.due, range.end));
  }
  // A due date without a time that the start lands after on its own day is
  // held at the end of that day, so the server never pulls the start back.
  const start =
    ends.find((saved) => saved.field === 'start')?.value ?? previous.start;
  const dueIndex = ends.findIndex((saved) => saved.field === 'due');
  const due =
    ends.find((saved) => saved.field === 'due')?.value ?? previous.due;
  if (
    !range.allDay &&
    previous.wholeDay === 'due' &&
    due &&
    start > due &&
    isSameDay(start, due)
  ) {
    const held: RescheduledEnd = {
      field: 'due',
      value: endOfDay(due),
      hasTime: false,
    };
    if (dueIndex >= 0) ends[dueIndex] = held;
    else ends.push(held);
  }
  if (ends.length === 2 && previous.due && start > previous.due) {
    ends.reverse();
  }
  return ends;
}

/** The calendar days from `start` to `due`, both counted. */
export function startDueDays(start: Date, due: Date): number {
  return differenceInCalendarDays(due, start) + 1;
}

/**
 * The dates after `day` is picked for `field`, so the range never runs
 * backwards. A due day before the start becomes the start. A start day after
 * the due date becomes the start and moves the due date with it, keeping the
 * range's length, as a calendar event's end follows its start; a start on or
 * before the due date never moves it. `changed` names the ends that moved.
 */
export function pickDay(
  dates: StartDue,
  field: DateField,
  day: Date
): { dates: StartDue; changed: DateField[] } {
  if (
    field === 'due' &&
    dates.start &&
    differenceInCalendarDays(day, dates.start) < 0
  ) {
    return { dates: { ...dates, start: day }, changed: ['start'] };
  }
  if (
    field === 'start' &&
    dates.due &&
    differenceInCalendarDays(day, dates.due) > 0
  ) {
    const days = dates.start
      ? Math.max(0, differenceInCalendarDays(dates.due, dates.start))
      : 0;
    return {
      dates: { ...dates, start: day, due: addDays(startOfDay(day), days) },
      changed: ['start', 'due'],
    };
  }
  return { dates: { ...dates, [field]: day }, changed: [field] };
}

/**
 * `pickDay` for dates with times: each end that moves keeps its own time of
 * day on its new day.
 */
export function pickTimedDay(
  dates: StartDue,
  field: DateField,
  day: Date
): { dates: StartDue; changed: DateField[] } {
  const clockOf = (end: DateField) => {
    const value = dates[end] ?? dates[end === 'start' ? 'due' : 'start'];
    return value ? value.getHours() * 60 + value.getMinutes() : 0;
  };
  const picked = pickDay(
    {
      start: dates.start && startOfDay(dates.start),
      due: dates.due && startOfDay(dates.due),
    },
    field,
    startOfDay(day)
  );
  const next = { ...dates };
  for (const end of picked.changed) {
    next[end] = atClock(picked.dates[end]!, clockOf(end));
  }
  // Back on one day, the restored times can put the due date before the
  // start; the end that was picked wins, as a picked time does.
  if (next.start && next.due && next.due < next.start) {
    return field === 'due'
      ? { dates: { ...next, start: next.due }, changed: ['start', 'due'] }
      : { dates: { ...next, due: next.start }, changed: ['start', 'due'] };
  }
  return { dates: next, changed: picked.changed };
}

function dayOf(property: Property | undefined): Date | null {
  if (!property || !isDateProperty(property) || property.value == null) {
    return null;
  }
  return new Date(property.value);
}

/** The ends a Start Date and a Due Date property hold. */
export function startDueOf(
  start: Property | undefined,
  due: Property | undefined
): StartDue {
  const hasTime = (end: Property | undefined) =>
    !!end && isDateProperty(end) && end.hasTime === true;
  const dates = { start: dayOf(start), due: dayOf(due) };
  if (!hasTime(start) && !hasTime(due)) return dates;
  const wholeDay: DateField | undefined =
    dates.start && dates.due && hasTime(start) !== hasTime(due)
      ? hasTime(start)
        ? 'due'
        : 'start'
      : undefined;
  return { ...dates, timed: true, ...(wholeDay ? { wholeDay } : {}) };
}

/** The end a Start Date or Due Date definition holds, or none for others. */
export function dateFieldOf(definitionId: string): DateField | undefined {
  if (definitionId === SYSTEM_PROPERTY_IDS.START_DATE) return 'start';
  if (definitionId === SYSTEM_PROPERTY_IDS.DUE_DATE) return 'due';
  return undefined;
}
