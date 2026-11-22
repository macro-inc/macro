import type { CalendarEvent } from '@app/features/calendar/types';

export type MonthEvent = Pick<CalendarEvent, 'id' | 'start' | 'end' | 'allDay'>;
export type MonthDay<T extends MonthEvent> = { date: Date; events: T[] };
export type MonthBar<T extends MonthEvent> = {
  event: T;
  startColumn: number;
  endColumn: number;
  lane: number;
};

/** The phone face always starts on Sunday and uses five or six complete weeks. */
export function phoneMonthRange(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const dayCount = Math.max(
    35,
    Math.ceil((first.getDay() + last.getDate()) / 7) * 7
  );
  const start = new Date(first);
  start.setDate(start.getDate() - first.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + dayCount);
  return { start, end, dayCount, weekCount: dayCount / 7 };
}

/** Keep the date heading clear and reserve one 16px slot for each displayed row. */
export function phoneMonthBarCapacity(
  height: number | null,
  weekCount: number
) {
  const maximum = weekCount === 6 ? 4 : 5;
  if (!height) return maximum;
  // Dates occupy 32px; the last 14px bar needs no trailing 2px of its 16px pitch.
  return Math.max(
    1,
    Math.min(maximum, Math.floor((height / weekCount - 32 + 2) / 16))
  );
}
/** Assign shared lanes before clipping, so a multi-day bar never jumps between cells. */
export function layoutPhoneMonthWeek<T extends MonthEvent>(
  days: readonly MonthDay<T>[],
  capacity: number
) {
  const spans = new Map<string, Omit<MonthBar<T>, 'lane'>>();
  days.forEach((day, column) => {
    for (const event of day.events) {
      const span = spans.get(event.id);
      if (span) span.endColumn = column + 1;
      else
        spans.set(event.id, {
          event,
          startColumn: column,
          endColumn: column + 1,
        });
    }
  });

  const ordered = [...spans.values()].sort(
    (a, b) =>
      Number(b.event.allDay) - Number(a.event.allDay) ||
      b.endColumn - b.startColumn - (a.endColumn - a.startColumn) ||
      a.startColumn - b.startColumn ||
      Date.parse(a.event.start) - Date.parse(b.event.start) ||
      a.event.id.localeCompare(b.event.id)
  );
  const bars: MonthBar<T>[] = [];
  for (const span of ordered) {
    let lane = 0;
    while (
      bars.some(
        (bar) =>
          bar.lane === lane &&
          bar.startColumn < span.endColumn &&
          span.startColumn < bar.endColumn
      )
    )
      lane += 1;
    bars.push({ ...span, lane });
  }

  // Reserve overflow only in the cells that need it. Split a crossing bar
  // around a reserved slot without moving the rest of that bar to another lane.
  const limits = days.map((_, column) =>
    bars.some(
      (bar) =>
        bar.startColumn <= column &&
        bar.endColumn > column &&
        bar.lane >= capacity
    )
      ? capacity - 1
      : capacity
  );
  const visible: MonthBar<T>[] = [];
  for (const bar of bars) {
    if (bar.lane >= capacity) continue;
    let startColumn: number | undefined;
    for (let column = bar.startColumn; column <= bar.endColumn; column += 1) {
      const shown = column < bar.endColumn && bar.lane < limits[column]!;
      if (shown && startColumn === undefined) startColumn = column;
      if (!shown && startColumn !== undefined) {
        visible.push({ ...bar, startColumn, endColumn: column });
        startColumn = undefined;
      }
    }
  }
  const hidden = days.map((day, column) => {
    const shown = visible.filter(
      (bar) => bar.startColumn <= column && bar.endColumn > column
    ).length;
    return Math.max(0, day.events.length - shown);
  });
  return { days, bars: visible, hidden };
}
