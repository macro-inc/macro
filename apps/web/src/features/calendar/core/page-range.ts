import {
  addDays,
  endOfMonth,
  isWeekend,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { CalendarGridPeriodView } from '../types';

/** Logical display metadata remains available before an interactive grid mounts. */
export interface CalendarPageDateInfo {
  start: Date;
  end: Date;
  view: { type: string; currentStart: Date; currentEnd: Date };
}

/** The phone face always starts on Sunday and uses five or six complete weeks. */
export function phoneMonthRange(month: Date) {
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const dayCount = Math.max(
    35,
    Math.ceil((first.getDay() + last.getDate()) / 7) * 7
  );
  const start = addDays(first, -first.getDay());
  return {
    start,
    end: addDays(start, dayCount),
    dayCount,
    weekCount: dayCount / 7,
  };
}

/** Plan the displayed range without mounting a calendar renderer. */
export function calendarPageRange(
  date: Date,
  view: CalendarGridPeriodView,
  options: {
    weekStartsOn: 0 | 1;
    showWeekends: boolean;
    phone: boolean;
  }
) {
  if (view === 'dayGridMonth' && options.phone) return phoneMonthRange(date);
  let start = startOfDay(date);
  let end: Date;
  if (view === 'dayGridMonth') {
    start = startOfWeek(startOfMonth(date), {
      weekStartsOn: options.weekStartsOn,
    });
    end = addDays(
      startOfWeek(endOfMonth(date), { weekStartsOn: options.weekStartsOn }),
      7
    );
  } else if (view === 'timeGridWeek') {
    start = startOfWeek(date, { weekStartsOn: options.weekStartsOn });
    end = addDays(start, 7);
  } else {
    if (view === 'timeGridDay' && !options.showWeekends)
      while (isWeekend(start)) start = addDays(start, 1);
    end = addDays(start, view === 'timeGridThreeDay' ? 3 : 1);
  }
  if (!options.showWeekends) {
    while (isWeekend(start)) start = addDays(start, 1);
    while (isWeekend(addDays(end, -1))) end = addDays(end, -1);
  }
  return { start, end };
}

export function calendarPageDateInfo(
  date: Date,
  view: CalendarGridPeriodView,
  options: Parameters<typeof calendarPageRange>[2]
): CalendarPageDateInfo {
  const range = calendarPageRange(date, view, options);
  const currentStart =
    view === 'dayGridMonth' ? startOfMonth(date) : range.start;
  return {
    ...range,
    view: {
      type: view,
      currentStart,
      currentEnd:
        view === 'dayGridMonth'
          ? startOfDay(addDays(endOfMonth(date), 1))
          : range.end,
    },
  };
}
