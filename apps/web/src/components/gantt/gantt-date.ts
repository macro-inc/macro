import { match } from 'ts-pattern';

export type GanttDate = string | Date | null | undefined;
export type GanttScale = 'day' | 'week' | 'month';
export type GanttInterval = { start: GanttDate; end?: GanttDate };
/** Calendar-day ordinals, with an exclusive end. */
export type GanttRange = { start: number; end: number };
export type GanttTick = { start: number; end: number; label: string };

const DAY_MS = 86_400_000;

function ordinal(year: number, month: number, day: number) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime() / DAY_MS;
}

/** Date-only values keep their stated day; timestamps use the viewer's local day. */
export function toGanttDay(value: GanttDate): number | undefined {
  if (value == null || value === '') return;

  if (typeof value === 'string') {
    const parts = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value);
    if (!parts) return;
    const year = Number(parts[1]);
    const month = Number(parts[2]) - 1;
    const day = Number(parts[3]);
    const result = ordinal(year, month, day);
    const date = new Date(result * DAY_MS);
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month ||
      date.getUTCDate() !== day
    )
      return;
    if (value.length === 10) return result;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return;
  return ordinal(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Property writes use local midnight, matching the existing date-picker calendar day. */
export function ganttDateFromDay(day: number): Date {
  const utc = new Date(day * DAY_MS);
  const date = new Date(0);
  date.setFullYear(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
  date.setHours(0, 0, 0, 0);
  return date;
}
export function formatGanttDay(day: number, includeYear = true): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  }).format(new Date(day * DAY_MS));
}

export function ganttPixelsPerDay(scale: GanttScale): number {
  return match(scale)
    .with('day', () => 40)
    .with('week', () => 20)
    .with('month', () => 6)
    .exhaustive();
}

export function deriveGanttRange(
  intervals: readonly GanttInterval[],
  today: GanttDate = new Date()
): GanttRange {
  const current = toGanttDay(today) ?? toGanttDay(new Date())!;
  let start = current;
  let end = current;
  for (const interval of intervals) {
    const first = toGanttDay(interval.start);
    const last = toGanttDay(interval.end);
    if (first !== undefined) {
      start = Math.min(start, first);
      end = Math.max(end, first);
    }
    if (last !== undefined && (first === undefined || last >= first)) {
      start = Math.min(start, last);
      end = Math.max(end, last);
    }
  }
  return { start: start - 7, end: end + 15 };
}

export function normalizeGanttRange(range: GanttRange): GanttRange {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) {
    return deriveGanttRange([]);
  }
  const start = Math.floor(range.start);
  return { start, end: Math.max(start + 1, Math.ceil(range.end)) };
}

export type GanttBarGeometry =
  | {
      kind:
        | 'missing-start'
        | 'invalid-start'
        | 'invalid-end'
        | 'reversed'
        | 'outside';
    }
  | {
      kind: 'scheduled' | 'open-ended';
      left: number;
      width: number;
      start: number;
      end?: number;
    };

/** Inclusive deadlines occupy their final day, including same-day intervals. */
export function ganttBarGeometry(
  interval: GanttInterval,
  range: GanttRange,
  pixelsPerDay: number
): GanttBarGeometry {
  const start = toGanttDay(interval.start);
  if (start === undefined) {
    return {
      kind:
        interval.start == null || interval.start === ''
          ? 'missing-start'
          : 'invalid-start',
    };
  }
  const missingEnd = interval.end == null || interval.end === '';
  const end = toGanttDay(interval.end);
  if (!missingEnd && end === undefined) return { kind: 'invalid-end' };
  if (end !== undefined && end < start) return { kind: 'reversed' };

  const clippedStart = Math.max(start, range.start);
  const clippedEnd = Math.min(
    end === undefined ? range.end : end + 1,
    range.end
  );
  if (clippedEnd <= clippedStart) return { kind: 'outside' };
  return {
    kind: end === undefined ? 'open-ended' : 'scheduled',
    left: (clippedStart - range.start) * pixelsPerDay,
    width: (clippedEnd - clippedStart) * pixelsPerDay,
    start,
    end,
  };
}

function monthStart(day: number): number {
  const date = new Date(day * DAY_MS);
  return ordinal(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function nextMonth(day: number): number {
  const date = new Date(day * DAY_MS);
  return ordinal(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

/** Generate only visible ticks; long schedules do not create one node per calendar day. */
export function ganttTicks(
  range: GanttRange,
  scale: GanttScale,
  visible: GanttRange = range
): GanttTick[] {
  const first = Math.max(range.start, Math.floor(visible.start));
  const last = Math.min(range.end, Math.ceil(visible.end));
  if (last <= first) return [];

  let cursor = match(scale)
    .with('day', () => first)
    .with(
      'week',
      () => first - ((new Date(first * DAY_MS).getUTCDay() + 6) % 7)
    )
    .with('month', () => monthStart(first))
    .exhaustive();
  const ticks: GanttTick[] = [];
  // A malformed or enormous visible range must not block the main thread.
  while (cursor < last && ticks.length < 1_000) {
    const next =
      scale === 'month'
        ? nextMonth(cursor)
        : cursor + (scale === 'week' ? 7 : 1);
    const label =
      scale === 'month'
        ? new Intl.DateTimeFormat('en-US', {
            month: 'short',
            year: '2-digit',
            timeZone: 'UTC',
          })
            .formatToParts(new Date(cursor * DAY_MS))
            .map((part) =>
              part.type === 'year' ? `'${part.value}` : part.value
            )
            .join('')
        : scale === 'day'
          ? String(new Date(cursor * DAY_MS).getUTCDate())
          : formatGanttDay(cursor, false);
    ticks.push({
      start: Math.max(cursor, range.start),
      end: Math.min(next, range.end),
      label,
    });
    cursor = next;
  }
  return ticks;
}
