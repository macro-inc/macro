import { TZDateMini } from '@date-fns/tz';
import type { Booking } from './types';

export type InsightRange = { from: string; to: string };
export type InsightMetric =
  | 'total'
  | 'completed'
  | 'rescheduled'
  | 'cancelled'
  | 'guestNoShow'
  | 'hostNoShow';
export type InsightCounts = Record<InsightMetric, number>;
export type InsightDay = InsightCounts & { date: string };
export type InsightPeriod = {
  bookings: Booking[];
  counts: InsightCounts;
  days: InsightDay[];
  hours: number[];
  meetingMinutes: number;
  averageMinutes: number;
  eventCounts: { id: string; name: string; count: number }[];
  hostCounts: { id: string; count: number }[];
};

const DAY_MS = 86_400_000;

function reportDateFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function formattedDate(date: Date, formatter: Intl.DateTimeFormat): string {
  const parts = formatter.formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function reportDate(date: Date, timeZone: string): string {
  return formattedDate(date, reportDateFormatter(timeZone));
}

export function shiftReportDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function dateStamp(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Number.NaN;
  const value = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(value) &&
    new Date(value).toISOString().slice(0, 10) === date
    ? value
    : Number.NaN;
}

export function insightRangeError(range: InsightRange): string | undefined {
  const from = dateStamp(range.from);
  const to = dateStamp(range.to);
  if (!Number.isFinite(from) || !Number.isFinite(to))
    return 'Choose a start and end date.';
  if (from > to) return 'End date must be on or after start date.';
  if ((to - from) / DAY_MS >= 366)
    return 'Choose a date range of up to 366 days.';
}

export function previousInsightRange(range: InsightRange): InsightRange {
  const days = (dateStamp(range.to) - dateStamp(range.from)) / DAY_MS + 1;
  return {
    from: shiftReportDate(range.from, -days),
    to: shiftReportDate(range.from, -1),
  };
}

/** UTC half-open bounds covering the report and its equally long preceding period. */
export function insightsQueryRange(
  from: string,
  to: string,
  timeZone: string
): InsightRange {
  const range = { from, to };
  const error = insightRangeError(range);
  if (error) throw new Error(error);
  const midnight = (date: string) => {
    const [year, month, day] = date.split('-').map(Number);
    return new TZDateMini(
      year,
      month - 1,
      day,
      0,
      0,
      0,
      timeZone
    ).toISOString();
  };
  return {
    from: midnight(previousInsightRange(range).from),
    to: midnight(shiftReportDate(to, 1)),
  };
}

export function insightPresetRange(
  days: number,
  timeZone: string,
  now = new Date()
): InsightRange {
  const to = reportDate(now, timeZone);
  return { from: shiftReportDate(to, 1 - days), to };
}

function emptyCounts(): InsightCounts {
  return {
    total: 0,
    completed: 0,
    rescheduled: 0,
    cancelled: 0,
    guestNoShow: 0,
    hostNoShow: 0,
  };
}

function bookingCounts(booking: Booking, now: number): InsightCounts {
  const guestNoShow = booking.attendance === 'guestNoShow';
  const hostNoShow = booking.attendance === 'hostNoShow';
  return {
    total: 1,
    completed: Number(
      booking.status === 'confirmed' &&
        Date.parse(booking.endsAt) <= now &&
        !guestNoShow &&
        !hostNoShow
    ),
    rescheduled: Number((booking.rescheduleCount ?? 0) > 0),
    cancelled: Number(booking.status === 'cancelled'),
    guestNoShow: Number(guestNoShow),
    hostNoShow: Number(hostNoShow),
  };
}

function addCounts(to: InsightCounts, from: InsightCounts): void {
  for (const key of Object.keys(from) as InsightMetric[]) to[key] += from[key];
}

/** Groups by booking start date in the report's time zone, including both end dates. */
export function buildInsightPeriod(
  bookings: Booking[],
  range: InsightRange,
  timeZone: string,
  now = new Date()
): InsightPeriod {
  const counts = emptyCounts();
  const days: InsightDay[] = [];
  if (!insightRangeError(range)) {
    for (
      let date = range.from;
      date <= range.to;
      date = shiftReportDate(date, 1)
    )
      days.push({ date, ...emptyCounts() });
  }
  const byDate = new Map(days.map((day) => [day.date, day]));
  const hours = Array.from({ length: 24 }, () => 0);
  const dateFormat = reportDateFormatter(timeZone);
  const hourFormat = new Intl.DateTimeFormat('en', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
  });
  const visible: Booking[] = [];
  const events = new Map<string, { id: string; name: string; count: number }>();
  const hosts = new Map<string, number>();
  let meetingMinutes = 0;
  let durationMinutes = 0;
  let durationCount = 0;
  for (const booking of bookings) {
    if (booking.status === 'failed' || booking.status === 'processing')
      continue;
    const start = new Date(booking.startsAt);
    const end = new Date(booking.endsAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()))
      continue;
    const day = byDate.get(formattedDate(start, dateFormat));
    if (!day) continue;
    visible.push(booking);
    const values = bookingCounts(booking, now.getTime());
    addCounts(counts, values);
    addCounts(day, values);
    hours[Number(hourFormat.format(start))] += 1;
    const event = events.get(booking.eventTypeId) ?? {
      id: booking.eventTypeId,
      name: booking.title,
      count: 0,
    };
    event.count += 1;
    events.set(booking.eventTypeId, event);
    for (const host of new Set(booking.hosts))
      hosts.set(host, (hosts.get(host) ?? 0) + 1);
    const minutes = Math.max(0, (end.getTime() - start.getTime()) / 60_000);
    if (booking.status === 'confirmed') {
      durationCount += 1;
      durationMinutes += minutes;
    }
    if (values.completed) meetingMinutes += minutes;
  }
  return {
    bookings: visible.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    counts,
    days,
    hours,
    meetingMinutes,
    averageMinutes: durationCount ? durationMinutes / durationCount : 0,
    eventCounts: [...events.values()].sort((a, b) => b.count - a.count),
    hostCounts: [...hosts]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export function insightComparison(current: number, previous: number): string {
  if (current === previous) return '0%';
  if (previous === 0) return 'New';
  const delta = Math.round(((current - previous) / previous) * 100);
  return `${delta > 0 ? '+' : ''}${delta}%`;
}

function csvCell(value: string | number): string {
  let text = String(value);
  // Guest-supplied values must stay text when opened in spreadsheet software.
  if (/^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function insightsCsv(
  bookings: Booking[],
  hostNames: ReadonlyMap<string, string> = new Map()
): string {
  const rows = [
    [
      'Booking ID',
      'Event',
      'Guest name',
      'Guest email',
      'Start',
      'End',
      'Guest time zone',
      'Status',
      'Attendance',
      'Times rescheduled',
      'Hosts',
    ],
    ...bookings.map((b) => [
      b.id,
      b.title,
      b.name,
      b.email,
      b.startsAt,
      b.endsAt,
      b.timeZone,
      b.status,
      b.attendance ?? 'unknown',
      b.rescheduleCount ?? 0,
      b.hosts.map((id) => hostNames.get(id) ?? id).join('; '),
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
