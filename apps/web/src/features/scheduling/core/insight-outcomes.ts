import type { Booking } from './types';

export type InsightOutcomeKey =
  | 'cancelled'
  | 'pendingApproval'
  | 'hostNoShow'
  | 'guestNoShow'
  | 'completed'
  | 'upcoming';
export type InsightOutcomeRow = {
  key: InsightOutcomeKey;
  label: string;
  count: number;
};

const OUTCOMES: readonly Pick<InsightOutcomeRow, 'key' | 'label'>[] = [
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'pendingApproval', label: 'Pending approval' },
  { key: 'hostNoShow', label: 'Host no-show' },
  { key: 'guestNoShow', label: 'Guest no-show' },
  { key: 'completed', label: 'Completed' },
  { key: 'upcoming', label: 'Upcoming' },
];

/** Counts mutually exclusive booking outcomes, separate from overlapping insight metrics. */
export function insightOutcomes(
  bookings: readonly Booking[],
  now = new Date()
): InsightOutcomeRow[] {
  const counts: Record<InsightOutcomeKey, number> = {
    cancelled: 0,
    pendingApproval: 0,
    hostNoShow: 0,
    guestNoShow: 0,
    completed: 0,
    upcoming: 0,
  };
  for (const booking of bookings) {
    if (booking.status === 'failed' || booking.status === 'processing')
      continue;
    const start = Date.parse(booking.startsAt);
    const end = Date.parse(booking.endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    if (booking.status === 'cancelled') counts.cancelled++;
    else if (booking.status === 'pending') counts.pendingApproval++;
    else if (booking.attendance === 'hostNoShow') counts.hostNoShow++;
    else if (booking.attendance === 'guestNoShow') counts.guestNoShow++;
    else if (end <= now.getTime()) counts.completed++;
    else counts.upcoming++;
  }
  return OUTCOMES.map(({ key, label }) => ({ key, label, count: counts[key] }));
}
