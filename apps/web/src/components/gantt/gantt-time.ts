/**
 * Times of day on the Gantt calendar. A position is a day ordinal plus the
 * share of that local day elapsed, so a 23- or 25-hour daylight-saving day
 * still fills exactly one day's width.
 */

import { addDays } from 'date-fns';
import {
  type GanttBarGeometry,
  type GanttDate,
  type GanttRange,
  type GanttScale,
  ganttDateFromDay,
  toGanttDay,
} from './gantt-date';
import type { GanttRescheduleEdge } from './gantt-interaction';

const MINUTE_MS = 60_000;

/** Pixels per day from which the calendar shows hours. */
export const GANTT_HOURS_PIXELS_PER_DAY = 120;
/** The closest zoom when a chart shows hours: 60px an hour. */
export const MAX_GANTT_HOURS_PIXELS_PER_DAY = 1_440;
/** A timed bar stays wide enough to see and grab, however short. */
const MIN_GANTT_TIMED_BAR_WIDTH = 6;
/** The narrowest spacing between hour labels, so they never overlap. */
const MIN_HOUR_LABEL_SPACING = 44;
const HOUR_STEPS = [1, 2, 3, 6, 12] as const;

/** An exact instant; undefined when empty or unreadable. */
export function toGanttInstant(value: GanttDate): Date | undefined {
  if (value == null || value === '') return;
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isFinite(instant.getTime()) ? instant : undefined;
}

/** The calendar position of an instant in the viewer's local time. */
export function ganttPosition(instant: Date): number {
  const day = toGanttDay(instant);
  if (day === undefined) return Number.NaN;
  const midnight = ganttDateFromDay(day).getTime();
  const length = ganttDateFromDay(day + 1).getTime() - midnight;
  return day + (instant.getTime() - midnight) / length;
}

/** The instant at a calendar position, the inverse of `ganttPosition`. */
export function ganttInstant(position: number): Date {
  const day = Math.floor(position);
  const midnight = ganttDateFromDay(day).getTime();
  const length = ganttDateFromDay(day + 1).getTime() - midnight;
  return new Date(midnight + (position - day) * length);
}

/** The nearest local wall-clock time on a `minutes` boundary. */
export function snapGanttInstant(instant: Date, minutes: number): Date {
  const elapsed =
    instant.getHours() * 60 +
    instant.getMinutes() +
    instant.getSeconds() / 60 +
    instant.getMilliseconds() / MINUTE_MS;
  return new Date(
    instant.getFullYear(),
    instant.getMonth(),
    instant.getDate(),
    0,
    Math.round(elapsed / minutes) * minutes
  );
}

/** How far a timed edge moves at a zoom: whole days, or a step of minutes. */
export type GanttTimeSnap = 'day' | number;

/** Whole days at week and month zoom, hours at day zoom, quarter hours at hours zoom. */
export function ganttTimeSnap(scale: GanttScale): GanttTimeSnap {
  if (scale === 'hour') return 15;
  if (scale === 'day') return 60;
  return 'day';
}

export type GanttTimes = { start: Date; end: Date };

/**
 * A timed range after dragging `edge` from position `from` to `to`. Day
 * steps keep each end's time of day; minute steps snap the dragged edge and
 * a move keeps the duration. An edge stops a step short of the other, or
 * where it was when the range is already shorter.
 */
export function rescheduledGanttTimes(
  times: GanttTimes,
  edge: GanttRescheduleEdge,
  from: number,
  to: number,
  snap: GanttTimeSnap
): GanttTimes {
  const { start, end } = times;
  if (snap === 'day') {
    let days = Math.round(to - from);
    if (edge === 'move')
      return { start: addDays(start, days), end: addDays(end, days) };
    if (edge === 'start') {
      while (days > 0 && addDays(start, days) >= end) days--;
      return { start: addDays(start, days), end };
    }
    while (days < 0 && addDays(end, days) <= start) days++;
    return { start, end: addDays(end, days) };
  }
  const moved = (instant: Date) =>
    snapGanttInstant(ganttInstant(ganttPosition(instant) + to - from), snap);
  const step = snap * MINUTE_MS;
  if (edge === 'move') {
    const next = moved(start);
    return {
      start: next,
      end: new Date(next.getTime() + end.getTime() - start.getTime()),
    };
  }
  if (edge === 'start')
    return {
      start: new Date(
        Math.min(
          moved(start).getTime(),
          Math.max(end.getTime() - step, start.getTime())
        )
      ),
      end,
    };
  return {
    start,
    end: new Date(
      Math.max(
        moved(end).getTime(),
        Math.min(start.getTime() + step, end.getTime())
      )
    ),
  };
}

/** The quarter hours a drag from position `first` to `last` selects, at least one. */
export function ganttTimedCreation(first: number, last: number): GanttTimes {
  const start = snapGanttInstant(ganttInstant(Math.min(first, last)), 15);
  const end = snapGanttInstant(ganttInstant(Math.max(first, last)), 15);
  return {
    start,
    end: new Date(Math.max(end.getTime(), start.getTime() + 15 * MINUTE_MS)),
  };
}

/** A timed range drawn between its instants, clipped to the calendar. */
export function ganttTimedBarGeometry(
  times: GanttTimes,
  range: GanttRange,
  pixelsPerDay: number
): GanttBarGeometry {
  const start = ganttPosition(times.start);
  const end = ganttPosition(times.end);
  if (!Number.isFinite(start)) return { kind: 'invalid-start' };
  if (!Number.isFinite(end)) return { kind: 'invalid-end' };
  if (end < start) return { kind: 'reversed' };
  const clippedStart = Math.max(start, range.start);
  const clippedEnd = Math.min(end, range.end);
  if (clippedEnd < clippedStart || clippedStart >= range.end)
    return { kind: 'outside' };
  return {
    kind: 'scheduled',
    left: (clippedStart - range.start) * pixelsPerDay,
    width: Math.max(
      MIN_GANTT_TIMED_BAR_WIDTH,
      (clippedEnd - clippedStart) * pixelsPerDay
    ),
    start,
    end,
  };
}

/** Hours between labelled ticks: the finest step whose labels do not overlap. */
export function ganttHourStep(pixelsPerDay: number): number {
  const pixelsPerHour = pixelsPerDay / 24;
  return (
    HOUR_STEPS.find(
      (hours) => hours * pixelsPerHour >= MIN_HOUR_LABEL_SPACING
    ) ?? 24
  );
}

export type GanttHourTick = { position: number; label: string };

/** The visible hour ticks between midnights; midnight itself is the day's edge. */
export function ganttHourTicks(
  range: GanttRange,
  pixelsPerDay: number,
  visible: GanttRange = range
): GanttHourTick[] {
  const step = ganttHourStep(pixelsPerDay);
  const first = Math.max(range.start, Math.floor(visible.start));
  const last = Math.min(range.end, Math.ceil(visible.end));
  const ticks: GanttHourTick[] = [];
  for (let day = first; day < last && ticks.length < 1_000; day++) {
    const midnight = ganttDateFromDay(day);
    for (let hour = step; hour < 24; hour += step) {
      const instant = new Date(midnight);
      instant.setHours(hour);
      // The hour skipped when clocks spring forward has no tick.
      if (instant.getHours() !== hour) continue;
      ticks.push({
        position: ganttPosition(instant),
        label: formatGanttTime(instant),
      });
    }
  }
  return ticks;
}

/** `9 AM`, or `9:30 AM` off the hour. */
export function formatGanttTime(instant: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    ...(instant.getMinutes() ? { minute: '2-digit' as const } : {}),
  }).format(instant);
}

/** `Fri, Oct 9`: a calendar day as the hours header names it. */
export function formatGanttWeekday(day: number): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(day * 86_400_000));
}

function formatDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(instant.getFullYear() === new Date().getFullYear()
      ? {}
      : { year: 'numeric' as const }),
  }).format(instant);
}

/** `Oct 9, 9 AM → Oct 13, 5 PM`, or `Oct 9, 9 AM – 5 PM` within one day. */
export function formatGanttTimeRange(times: GanttTimes): string {
  const start = `${formatDate(times.start)}, ${formatGanttTime(times.start)}`;
  return toGanttDay(times.start) === toGanttDay(times.end)
    ? `${start} – ${formatGanttTime(times.end)}`
    : `${start} → ${formatDate(times.end)}, ${formatGanttTime(times.end)}`;
}

/** `Fri, Oct 9, 9:00 AM`: an end as a drag shows it, to the minute. */
export function formatGanttInstant(instant: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(instant);
}

/**
 * The range something placed at `position` starts with: that whole day, or,
 * when `timed`, an hour from the nearest quarter hour.
 */
export function ganttPlacedRange(
  position: number,
  timed: boolean
): { start: Date; end: Date; allDay: boolean } {
  if (!timed) {
    const day = ganttDateFromDay(Math.floor(position));
    return { start: day, end: day, allDay: true };
  }
  const start = snapGanttInstant(ganttInstant(position), 15);
  return {
    start,
    end: new Date(start.getTime() + 60 * MINUTE_MS),
    allDay: false,
  };
}
