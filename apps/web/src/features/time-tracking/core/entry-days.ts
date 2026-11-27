import { addDays, format, parseISO } from 'date-fns';

/** The calendar day of `moment` on this device, `YYYY-MM-DD`: an entry's day. */
export function localDay(moment: Date): string {
  return format(moment, 'yyyy-MM-dd');
}

/** The device's calendar day before `day`. */
export function dayBefore(day: string): string {
  return localDay(addDays(parseISO(day), -1));
}

/** Which day an entry falls on, relative to today on this device. */
export type DayName =
  | { kind: 'today' }
  | { kind: 'yesterday' }
  | { kind: 'date'; date: Date };

export function dayName(day: string, today: string): DayName {
  if (day === today) return { kind: 'today' };
  if (day === dayBefore(today)) return { kind: 'yesterday' };
  return { kind: 'date', date: parseISO(day) };
}

/** Entries of one day, newest first, with their total in minutes. */
export type EntryDay<T> = { day: string; minutes: number; entries: T[] };

/**
 * Group entries into days with their totals, newest day first, keeping the
 * order the server returned within each day. An entry whose day was just
 * edited may still sit in its old place, so the days are put in order here.
 */
export function groupByDay<T extends { date: string; minutes: number }>(
  entries: readonly T[]
): EntryDay<T>[] {
  const days: EntryDay<T>[] = [];
  const newestFirst = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  for (const entry of newestFirst) {
    const last = days.at(-1);
    if (last?.day === entry.date) {
      last.entries.push(entry);
      last.minutes += entry.minutes;
    } else {
      days.push({ day: entry.date, minutes: entry.minutes, entries: [entry] });
    }
  }
  return days;
}
