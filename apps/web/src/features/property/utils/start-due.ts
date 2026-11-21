import { differenceInCalendarDays } from 'date-fns';
import { SYSTEM_PROPERTY_IDS } from '../identifiers';
import type { Property } from '../types';
import { isDateProperty } from './typeGuards';

/** Which end of a task's or project's dates the picker sets. */
export type DateField = 'start' | 'due';

/** A task's or project's Start Date and Due Date, each a whole local day. */
export type StartDue = { start: Date | null; due: Date | null };

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
 * differ, or `Nov 23 →` without a due date. Without a start there is no range;
 * the pill keeps the due date's own text.
 */
export function formatStartDue(
  dates: StartDue,
  now = new Date()
): string | undefined {
  const { start, due } = dates;
  if (!start) return undefined;
  if (!due) {
    const format =
      start.getFullYear() === now.getFullYear() ? DAY_FORMAT : DAY_YEAR_FORMAT;
    return `${format.format(start)} →`;
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

/** The calendar days from `start` to `due`, both counted. */
export function startDueDays(start: Date, due: Date): number {
  return differenceInCalendarDays(due, start) + 1;
}

/**
 * The dates after `day` is picked for `field`. A day on the far side of the
 * other end moves that end instead, so the range can never run backwards: a
 * due day before the start becomes the start, and a start day after the due
 * date becomes the due date. `changed` names the end that moved.
 */
export function pickDay(
  dates: StartDue,
  field: DateField,
  day: Date
): { dates: StartDue; changed: DateField } {
  if (
    field === 'due' &&
    dates.start &&
    differenceInCalendarDays(day, dates.start) < 0
  ) {
    return { dates: { ...dates, start: day }, changed: 'start' };
  }
  if (
    field === 'start' &&
    dates.due &&
    differenceInCalendarDays(day, dates.due) > 0
  ) {
    return { dates: { ...dates, due: day }, changed: 'due' };
  }
  return { dates: { ...dates, [field]: day }, changed: field };
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
  return { start: dayOf(start), due: dayOf(due) };
}

/** The end a Start Date or Due Date definition holds, or none for others. */
export function dateFieldOf(definitionId: string): DateField | undefined {
  if (definitionId === SYSTEM_PROPERTY_IDS.START_DATE) return 'start';
  if (definitionId === SYSTEM_PROPERTY_IDS.DUE_DATE) return 'due';
  return undefined;
}
