import type { CalendarEvent } from '@app/features/calendar/types';

export const PHONE_MONTH_DATE_HEIGHT = 32;
export const PHONE_MONTH_EVENT_HEIGHT = 14;
export const PHONE_MONTH_ROW_PITCH = 16;
export type MonthEvent = Pick<CalendarEvent, 'id' | 'start' | 'end' | 'allDay'>;
export type MonthDay<T extends MonthEvent> = { date: Date; events: T[] };
export type MonthBar<T extends MonthEvent> = {
  event: T;
  kind: 'span' | 'timed';
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

/** Fit complete rows below the date, including gaps and the shortest week's border. */
export function phoneMonthBarCapacity(
  height: number | null,
  weekCount: number
) {
  if (height === null || height <= 0 || weekCount <= 0) return 0;
  const cellHeight = height / weekCount - Number(weekCount > 1);
  const trailingGap = PHONE_MONTH_ROW_PITCH - PHONE_MONTH_EVENT_HEIGHT;
  return Math.max(
    0,
    Math.floor(
      (cellHeight - PHONE_MONTH_DATE_HEIGHT + trailingGap) /
        PHONE_MONTH_ROW_PITCH
    )
  );
}

function isSpanningEvent(event: MonthEvent) {
  if (event.allDay) return true;
  const nextDay = new Date(event.start);
  nextDay.setHours(24, 0, 0, 0);
  return new Date(event.end).getTime() > nextDay.getTime();
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
          kind: isSpanningEvent(event) ? 'span' : 'timed',
          endColumn: column + 1,
        });
    }
  });

  const ordered = [...spans.values()].sort(
    (a, b) =>
      Number(b.kind === 'span') - Number(a.kind === 'span') ||
      Number(b.event.allDay) - Number(a.event.allDay) ||
      b.endColumn - b.startColumn - (a.endColumn - a.startColumn) ||
      a.startColumn - b.startColumn ||
      Date.parse(a.event.start) - Date.parse(b.event.start) ||
      a.event.id.localeCompare(b.event.id)
  );
  const bars: MonthBar<T>[] = [];
  for (const span of ordered) {
    // Spans share lanes across the week. Timed rows start below every span in
    // their own day, rather than backfilling a gap above a continuing span.
    let lane = 0;
    if (span.kind === 'span') {
      while (
        bars.some(
          (bar) =>
            bar.lane === lane &&
            bar.startColumn < span.endColumn &&
            span.startColumn < bar.endColumn
        )
      )
        lane += 1;
    } else {
      for (const bar of bars) {
        if (
          bar.startColumn <= span.startColumn &&
          bar.endColumn > span.startColumn
        ) {
          lane = Math.max(lane, bar.lane + 1);
        }
      }
    }
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
