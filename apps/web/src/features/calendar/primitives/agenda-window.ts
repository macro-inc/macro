import { parseLocalDate } from '@core/util/local-date';
import { addDays, startOfDay } from 'date-fns';
import type { CalendarEvent } from '../types';

const AGENDA_WINDOW_DAYS = 14;
const AGENDA_MOUNTED_WINDOWS = 5;

/** End-exclusive local-day window; date arithmetic follows DST. */
export function agendaWindow(anchor: Date, index: number) {
  const start = addDays(startOfDay(anchor), index * AGENDA_WINDOW_DAYS);
  return { start, end: addDays(start, AGENDA_WINDOW_DAYS) };
}

/** Keep readable days at materialization boundaries instead of rejecting the whole window. */
export function clipAgendaWindow(
  window: { start: Date; end: Date },
  supported: { start: Date; end: Date }
): { start: Date; end: Date } | undefined {
  const start = window.start > supported.start ? window.start : supported.start;
  const end = window.end < supported.end ? window.end : supported.end;
  return start < end ? { start, end } : undefined;
}

export function agendaWindowIndices(first: number): number[] {
  return Array.from({ length: AGENDA_MOUNTED_WINDOWS }, (_, i) => first + i);
}

export type AgendaEvent = Pick<
  CalendarEvent,
  'id' | 'start' | 'end' | 'allDay' | 'isCancelled'
>;

export interface AgendaDay<T extends AgendaEvent> {
  date: Date;
  events: T[];
}
/** Event spans local dates; all-day ends are exclusive date strings. */
export function agendaEventsByDay<T extends AgendaEvent>(
  events: readonly T[],
  start: Date,
  dayCount = AGENDA_WINDOW_DAYS
): AgendaDay<T>[] {
  const days: AgendaDay<T>[] = Array.from({ length: dayCount }, (_, i) => ({
    date: addDays(startOfDay(start), i),
    events: [],
  }));
  for (const event of events) {
    if (event.isCancelled) continue;
    const beginning = event.allDay
      ? parseLocalDate(event.start)
      : new Date(event.start);
    const ending = event.allDay
      ? parseLocalDate(event.end)
      : new Date(event.end);
    if (!beginning || !ending) continue;
    if (
      !Number.isFinite(beginning.getTime()) ||
      !Number.isFinite(ending.getTime())
    )
      continue;
    if (ending < beginning) continue;
    // Timed point imports occupy their start day; an empty all-day range does not.
    if (event.allDay && ending.getTime() === beginning.getTime()) continue;
    for (const day of days) {
      const end = addDays(day.date, 1);
      if (
        beginning < end &&
        ending >= day.date &&
        (ending > day.date || beginning.getTime() === ending.getTime())
      ) {
        day.events.push(event);
      }
    }
  }
  for (const day of days) {
    day.events.sort(
      (a, b) =>
        Number(b.allDay) - Number(a.allDay) ||
        Date.parse(a.start) - Date.parse(b.start) ||
        a.id.localeCompare(b.id)
    );
  }
  return days;
}

export interface AgendaDayGroup<T extends AgendaEvent> {
  start: Date;
  end: Date;
  events: T[];
}

/** Merge only adjacent empty days; today remains a distinct landmark. */
export function groupAgendaDays<T extends AgendaEvent>(
  days: readonly AgendaDay<T>[],
  today: Date = new Date(),
  canGroup: (previous: Date, next: Date) => boolean = () => true
): AgendaDayGroup<T>[] {
  const groups: AgendaDayGroup<T>[] = [];
  const todayKey = startOfDay(today).getTime();
  for (const day of days) {
    const previous = groups[groups.length - 1];
    if (
      day.events.length === 0 &&
      previous?.events.length === 0 &&
      previous.end.getTime() !== todayKey &&
      day.date.getTime() !== todayKey &&
      canGroup(previous.end, day.date)
    ) {
      previous.end = day.date;
    } else {
      groups.push({ start: day.date, end: day.date, events: day.events });
    }
  }
  return groups;
}
