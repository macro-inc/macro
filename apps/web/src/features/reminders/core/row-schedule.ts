import type { EmailFollowup } from '@service-storage/generated/schemas/emailFollowup';
import { formatReminderOccurrence } from './schedule-instant';

/** Describe the email snooze's schedule and inbox restoration state. */
export function emailReminderScheduleLabel(
  followup: EmailFollowup,
  now: number,
  viewerTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
): string {
  const instant = formatReminderOccurrence(
    followup.remindAt,
    viewerTimezone,
    viewerTimezone
  );
  if (!instant) return 'Schedule unavailable';
  const status = {
    archiving: 'Scheduling return',
    pending: new Date(followup.remindAt).getTime() <= now ? 'Due' : 'Returning',
    returning: 'Returning to inbox',
    returned: 'Returned',
    cancelled: 'Cancelled',
    removed: 'Removed',
  }[followup.state];
  const conditional =
    followup.condition === 'if_no_reply' &&
    (followup.state === 'pending' || followup.state === 'archiving');
  return `${status}: ${instant}${conditional ? ' if no reply' : ''}`;
}
