import type { UpcomingCalendarEvent } from './upcoming-calendar-events';

/** How far ahead of a meeting the badge starts counting down. */
export const NEXT_MEETING_BADGE_HORIZON_MS = 60 * 60_000;

export type NextMeetingBadge =
  | { kind: 'now'; label: 'Now' }
  | { kind: 'soon'; label: string; minutes: number };

/**
 * The sidebar badge for the current moment: `Now` while a timed meeting is in
 * progress, else the minutes until the next timed meeting when it is under an
 * hour away. All-day events and non-meetings are ignored.
 */
export function nextMeetingBadge(
  events: readonly UpcomingCalendarEvent[],
  now: Date
): NextMeetingBadge | undefined {
  const nowMs = now.getTime();
  let soonest = Number.POSITIVE_INFINITY;
  for (const event of events) {
    if (event.allDay || !event.isMeeting) continue;
    const start = Date.parse(event.start);
    const end = Date.parse(event.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      continue;
    }
    if (start <= nowMs && nowMs < end) return { kind: 'now', label: 'Now' };
    if (start > nowMs) soonest = Math.min(soonest, start);
  }
  const untilMs = soonest - nowMs;
  if (untilMs >= NEXT_MEETING_BADGE_HORIZON_MS) return undefined;
  const minutes = Math.ceil(untilMs / 60_000);
  return { kind: 'soon', label: `${minutes}m`, minutes };
}
