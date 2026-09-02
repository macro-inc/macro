/**
 * Copy-availability domain logic: derives the viewer's free time slots from
 * calendar occurrences and formats them as shareable plain text. Everything
 * is computed in the viewer's local timezone.
 */

import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import type { CalendarTimeFormat } from '../types';
import { formatCalendarTime } from '../utils/time-format';
import { rangeTimeZoneLabel } from './zone-label';

/** Supported share ranges, in menu order. */
export type AvailabilityRangeKey =
  | 'today'
  | 'thisWeek'
  | 'next7Days'
  | 'next14Days';

export const AVAILABILITY_RANGE_OPTIONS: Array<{
  key: AvailabilityRangeKey;
  label: string;
}> = [
  { key: 'today', label: 'Today' },
  { key: 'thisWeek', label: 'This week' },
  { key: 'next7Days', label: 'Next 7 days' },
  { key: 'next14Days', label: 'Next 14 days' },
];

/** Personal copy-availability preferences. Times are local 'HH:MM'. */
export interface AvailabilitySettings {
  /** Workday start; slots never begin before this. */
  startTime: string;
  /** Workday end; slots never extend past this. */
  endTime: string;
  /** Whether Saturday and Sunday are omitted entirely. */
  excludeWeekends: boolean;
}

export const DEFAULT_AVAILABILITY_SETTINGS: AvailabilitySettings = {
  startTime: '09:00',
  endTime: '18:00',
  excludeWeekends: true,
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Coerces a persisted (and therefore untrusted) settings value into a valid
 * shape: malformed fields fall back to their defaults, and an inverted or
 * empty workday falls back entirely (keeping a valid weekend preference).
 */
export function sanitizeAvailabilitySettings(
  value: unknown
): AvailabilitySettings {
  const stored = (
    typeof value === 'object' && value !== null ? value : {}
  ) as Partial<Record<keyof AvailabilitySettings, unknown>>;
  const startTime =
    typeof stored.startTime === 'string' && TIME_PATTERN.test(stored.startTime)
      ? stored.startTime
      : DEFAULT_AVAILABILITY_SETTINGS.startTime;
  const endTime =
    typeof stored.endTime === 'string' && TIME_PATTERN.test(stored.endTime)
      ? stored.endTime
      : DEFAULT_AVAILABILITY_SETTINGS.endTime;
  const excludeWeekends =
    typeof stored.excludeWeekends === 'boolean'
      ? stored.excludeWeekends
      : DEFAULT_AVAILABILITY_SETTINGS.excludeWeekends;

  // 'HH:MM' strings order lexicographically, so <= is a time comparison.
  if (endTime <= startTime) {
    return { ...DEFAULT_AVAILABILITY_SETTINGS, excludeWeekends };
  }
  return { startTime, endTime, excludeWeekends };
}

/** One contiguous free interval within a single day. */
interface AvailabilitySlot {
  start: Date;
  end: Date;
}

/** A day's free slots; days with no free time are omitted from results. */
export interface AvailabilityDay {
  date: Date;
  slots: AvailabilitySlot[];
}

interface BusyInterval {
  start: number;
  end: number;
}

/** Free slots shorter than this read as noise, not availability. */
const MIN_SLOT_MS = 15 * 60_000;
/** "From now" starts get rounded up to this grain so times look natural. */
const NOW_ROUNDING_MS = 15 * 60_000;

function parseTimeToMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function startOfLocalDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/** Local wall-clock instant `minutes` past midnight on `day` (DST-safe). */
function atMinutes(day: Date, minutes: number): number {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    0,
    minutes
  ).getTime();
}

/**
 * The local-day span a range covers: `start` is the start of today and
 * `endExclusive` is the start of the day after the last included day.
 * "This week" runs through the coming Friday (today, when today is Friday);
 * the day-based ranges run through the same weekday 1–2 weeks out.
 */
export function resolveAvailabilityWindow(
  rangeKey: AvailabilityRangeKey,
  now: Date
): { start: Date; endExclusive: Date } {
  const start = startOfLocalDay(now);
  const lastDayOffset = (() => {
    switch (rangeKey) {
      case 'today':
        return 0;
      case 'thisWeek':
        return (5 - now.getDay() + 7) % 7;
      case 'next7Days':
        return 7;
      case 'next14Days':
        return 14;
    }
  })();

  return { start, endExclusive: addDays(start, lastDayOffset + 1) };
}

/**
 * Occurrences that actually block time: timed (all-day events are treated
 * as informational), not cancelled, not marked free (`transparent`), and
 * not declined by the viewer.
 */
export function busyIntervalsFromOccurrences(
  items: CalendarOccurrenceItem[]
): BusyInterval[] {
  const intervals: BusyInterval[] = [];
  for (const { event, occurrence } of items) {
    if (occurrence.time.kind !== 'timed') continue;
    if (occurrence.isCancelled || event.status === 'cancelled') continue;
    if (event.transparency === 'transparent') continue;
    const self = event.attendees?.find((attendee) => attendee.isSelf);
    if (self?.responseStatus === 'declined') continue;

    const start = Date.parse(occurrence.time.startsAt);
    const end = Date.parse(occurrence.time.endsAt);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue;
    intervals.push({ start, end });
  }
  return intervals;
}

function subtractBusy(
  windowStart: number,
  windowEnd: number,
  busy: BusyInterval[]
): AvailabilitySlot[] {
  const overlapping = busy
    .filter(
      (interval) => interval.end > windowStart && interval.start < windowEnd
    )
    .sort((a, b) => a.start - b.start);

  const slots: AvailabilitySlot[] = [];
  let cursor = windowStart;
  for (const interval of overlapping) {
    if (interval.start - cursor >= MIN_SLOT_MS) {
      slots.push({ start: new Date(cursor), end: new Date(interval.start) });
    }
    cursor = Math.max(cursor, interval.end);
    if (cursor >= windowEnd) return slots;
  }
  if (windowEnd - cursor >= MIN_SLOT_MS) {
    slots.push({ start: new Date(cursor), end: new Date(windowEnd) });
  }
  return slots;
}

/**
 * Free slots per day for a range: each day's workday window minus busy
 * intervals, weekends optionally excluded, and today's window starting no
 * earlier than `now` (rounded up to the next quarter hour). Days without
 * any free slot are omitted.
 */
export function computeAvailability(options: {
  rangeKey: AvailabilityRangeKey;
  settings: AvailabilitySettings;
  busyIntervals: BusyInterval[];
  now: Date;
}): AvailabilityDay[] {
  const { rangeKey, settings, busyIntervals, now } = options;
  const window = resolveAvailabilityWindow(rangeKey, now);
  const dayStartMinutes = parseTimeToMinutes(settings.startTime);
  const dayEndMinutes = parseTimeToMinutes(settings.endTime);
  if (dayEndMinutes <= dayStartMinutes) return [];

  const days: AvailabilityDay[] = [];
  for (
    let day = window.start;
    day < window.endExclusive;
    day = addDays(day, 1)
  ) {
    if (settings.excludeWeekends && isWeekend(day)) continue;

    let windowStart = atMinutes(day, dayStartMinutes);
    const windowEnd = atMinutes(day, dayEndMinutes);
    if (windowStart < now.getTime()) {
      windowStart =
        Math.ceil(now.getTime() / NOW_ROUNDING_MS) * NOW_ROUNDING_MS;
    }
    if (windowEnd - windowStart < MIN_SLOT_MS) continue;

    const slots = subtractBusy(windowStart, windowEnd, busyIntervals);
    if (slots.length > 0) days.push({ date: day, slots });
  }
  return days;
}

const dayLabelFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

/**
 * Formats availability as plain text ready for an email:
 *
 * ```
 * My availability (EDT):
 * Mon, Aug 24: 2:15 PM – 6:00 PM
 * Tue, Aug 25: 9:00 AM – 11:00 AM, 1:30 PM – 6:00 PM
 * ```
 *
 * The header label covers every listed slot: a range that spans a
 * daylight-saving transition gets a DST-agnostic label instead of the
 * abbreviation that only holds at copy time.
 */
export function formatAvailabilityText(
  days: AvailabilityDay[],
  timeFormat: CalendarTimeFormat,
  now: Date
): string {
  const boundaries = days.flatMap((day) =>
    day.slots.flatMap((slot) => [slot.start, slot.end])
  );
  const timeZone = rangeTimeZoneLabel(
    boundaries.length > 0 ? boundaries : [now]
  );
  const header = timeZone
    ? `My availability (${timeZone}):`
    : 'My availability:';
  const lines = days.map((day) => {
    const slots = day.slots
      .map(
        (slot) =>
          `${formatCalendarTime(slot.start, timeFormat)} – ${formatCalendarTime(slot.end, timeFormat)}`
      )
      .join(', ');
    return `${dayLabelFormatter.format(day.date)}: ${slots}`;
  });
  return [header, ...lines].join('\n');
}
