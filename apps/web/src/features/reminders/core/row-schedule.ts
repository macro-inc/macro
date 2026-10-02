import type { ReminderEntity } from '@entity';
import { describeReminderRecurrence } from './recurrence-label';
import { formatReminderOccurrence } from './schedule-instant';

/** Completion acknowledges an occurrence; it does not stop a recurring schedule. */
export function reminderScheduleState(
  reminder: Pick<
    ReminderEntity,
    'enabled' | 'completedAt' | 'scheduleType' | 'nextRunAt'
  >,
  now: number
): 'scheduled' | 'due' | 'paused' | 'completed' {
  if (reminder.completedAt && reminder.scheduleType === 'once')
    return 'completed';
  // Fired one-shots are disabled but remain due until acknowledged. A disabled
  // recurring series is paused instead, even when its stored occurrence is past.
  if (
    !reminder.completedAt &&
    (reminder.enabled || reminder.scheduleType === 'once') &&
    new Date(reminder.nextRunAt).getTime() <= now
  )
    return 'due';
  if (!reminder.enabled) return reminder.completedAt ? 'completed' : 'paused';
  return new Date(reminder.nextRunAt).getTime() > now ? 'scheduled' : 'due';
}

/** A concise next occurrence, with a zone only when it differs from the viewer's. */
export function reminderScheduleLabel(
  reminder: ReminderEntity,
  now: number,
  viewerTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
): string {
  const state = reminderScheduleState(reminder, now);
  const timezone =
    reminder.scheduleType === 'recurring'
      ? (reminder.timezone ?? viewerTimezone)
      : viewerTimezone;
  const instant = formatReminderOccurrence(
    reminder.nextRunAt,
    timezone,
    viewerTimezone
  );
  if (!instant) return 'Schedule unavailable';
  const recurrence =
    reminder.scheduleType === 'recurring' && reminder.cron
      ? describeReminderRecurrence(reminder.cron).cadence
      : undefined;
  const status = {
    scheduled: reminder.emailFollowup
      ? 'Returning'
      : reminder.scheduleType === 'recurring'
        ? 'Next'
        : 'Remind me',
    due: 'Due',
    paused: 'Paused',
    completed: 'Completed',
  }[state];
  const condition =
    reminder.emailFollowup?.condition === 'if_no_reply'
      ? 'if no reply'
      : undefined;
  return [
    `${status}: ${instant}${condition ? ` ${condition}` : ''}`,
    recurrence,
  ]
    .filter(Boolean)
    .join(' · ');
}
