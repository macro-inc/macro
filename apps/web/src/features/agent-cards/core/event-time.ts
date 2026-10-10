import { parseLocalDate } from '@app/features/calendar/utils/calendar-date';
import type { EventTime } from '@service-storage/generated/schemas/eventTime';

/** When an event happens, worded for a card or an agenda row. */
export type EventSchedule = {
  /** Local midnight of the day the event starts: what an agenda groups by. */
  day: Date;
  /** Start instant in milliseconds, local midnight for an all-day event. */
  start: number;
  /** `3:00 – 3:30 PM`, `All day`, or a range across days. */
  time: string;
  allDay: boolean;
  /** Whether the event is over. */
  past: boolean;
};

const DAY = { weekday: 'short', month: 'short', day: 'numeric' } as const;
const SHORT_DAY = { month: 'short', day: 'numeric' } as const;

function midnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function clock(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** `3:00 – 3:30 PM`, keeping the meridiem once when both ends share it. */
function clockRange(start: Date, end: Date): string {
  const from = clock(start);
  const to = clock(end);
  const meridiem = / (AM|PM)$/;
  const fromSuffix = meridiem.exec(from)?.[1];
  if (fromSuffix && fromSuffix === meridiem.exec(to)?.[1]) {
    return `${from.replace(meridiem, '')} – ${to}`;
  }
  return `${from} – ${to}`;
}

/** The schedule of an event's time, or undefined when it cannot be read. */
export function eventSchedule(
  time: EventTime,
  now: Date = new Date()
): EventSchedule | undefined {
  if (time.kind === 'timed') {
    const start = new Date(time.startsAt);
    const end = new Date(time.endsAt);
    if (!Number.isFinite(start.getTime())) return undefined;
    const ends = Number.isFinite(end.getTime()) ? end : start;
    const sameDay = midnight(start).getTime() === midnight(ends).getTime();
    return {
      day: midnight(start),
      start: start.getTime(),
      time:
        ends.getTime() === start.getTime()
          ? clock(start)
          : sameDay
            ? clockRange(start, ends)
            : `${start.toLocaleDateString('en-US', SHORT_DAY)}, ${clock(start)} – ${ends.toLocaleDateString('en-US', SHORT_DAY)}, ${clock(ends)}`,
      allDay: false,
      past: ends.getTime() <= now.getTime(),
    };
  }
  const start = parseLocalDate(time.startDate);
  if (!start) return undefined;
  // The end date is exclusive: an event on the 9th ends on the 10th.
  const after = parseLocalDate(time.endDate) ?? start;
  const last = new Date(
    after.getFullYear(),
    after.getMonth(),
    after.getDate() - 1
  );
  const multiDay = last.getTime() > start.getTime();
  return {
    day: start,
    start: start.getTime(),
    time: multiDay
      ? `All day · until ${last.toLocaleDateString('en-US', DAY)}`
      : 'All day',
    allDay: true,
    past: after.getTime() <= midnight(now).getTime(),
  };
}

/** `Today`, `Tomorrow`, `Yesterday`, or the date, with the year when it differs. */
export function dayLabel(day: Date, now: Date = new Date()): string {
  const today = midnight(now).getTime();
  const offset = Math.round((midnight(day).getTime() - today) / 86_400_000);
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  if (offset === -1) return 'Yesterday';
  return day.toLocaleDateString('en-US', {
    ...DAY,
    ...(day.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** Entries grouped by the day they start, days and entries in time order. */
export function groupByDay<T extends { schedule: EventSchedule }>(
  entries: readonly T[],
  now: Date = new Date()
): { day: Date; label: string; entries: T[] }[] {
  const sorted = [...entries].sort(
    (a, b) =>
      a.schedule.start - b.schedule.start ||
      Number(b.schedule.allDay) - Number(a.schedule.allDay)
  );
  const days: { day: Date; label: string; entries: T[] }[] = [];
  for (const entry of sorted) {
    const last = days.at(-1);
    if (last && last.day.getTime() === entry.schedule.day.getTime()) {
      last.entries.push(entry);
    } else {
      days.push({
        day: entry.schedule.day,
        label: dayLabel(entry.schedule.day, now),
        entries: [entry],
      });
    }
  }
  return days;
}
