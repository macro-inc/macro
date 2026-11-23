import type { CalendarEvent } from '@app/features/calendar/types';

export const PHONE_MONTH_DATE_HEIGHT = 32;
export const PHONE_MONTH_EVENT_HEIGHT = 24;
export const PHONE_MONTH_ROW_PITCH = 26;
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
/** Pack each day's rows, then join adjacent same-lane segments into span bars. */
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
  const visible: MonthBar<T>[] = [];
  const latestSegment = new Map<string, MonthBar<T>>();
  const hidden = days.map((_, column) => {
    const events = ordered.filter(
      (span) => span.startColumn <= column && span.endColumn > column
    );
    const limit =
      events.length > capacity ? Math.max(0, capacity - 1) : events.length;

    // A finished span must not leave a hole or force a false overflow count.
    // Compact each day first. Keep horizontal spans wherever the neighboring
    // day has the same row; split only at an actual row change or hidden day.
    events.slice(0, limit).forEach((span, lane) => {
      const previous = latestSegment.get(span.event.id);
      if (previous?.lane === lane && previous.endColumn === column) {
        previous.endColumn = column + 1;
        return;
      }
      const segment = {
        ...span,
        startColumn: column,
        endColumn: column + 1,
        lane,
      };
      visible.push(segment);
      latestSegment.set(span.event.id, segment);
    });
    return events.length - limit;
  });
  return { days, bars: visible, hidden };
}
