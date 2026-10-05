import type { ReminderEntity } from '@entity';
import { formatReminderOccurrence } from './schedule-instant';

/** Workflow progress is independent of its generic reminder's enabled flag. */
export function emailReminderScheduleLabel(
  reminder: ReminderEntity,
  now: number,
  viewerTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
): string {
  const followup = reminder.emailFollowup;
  if (!followup) return 'Schedule unavailable';
  const instant = formatReminderOccurrence(
    reminder.nextRunAt,
    viewerTimezone,
    viewerTimezone
  );
  if (!instant) return 'Schedule unavailable';
  const status = {
    archiving: 'Scheduling return',
    pending:
      new Date(reminder.nextRunAt).getTime() <= now ? 'Due' : 'Returning',
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
