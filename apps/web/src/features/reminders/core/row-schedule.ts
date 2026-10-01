import { isCronRepresentable } from '@core/util/cron';
import type { ReminderEntity } from '@entity';
import {
  describeReminderSchedule,
  scheduleFromRow,
} from '../reminder-schedule';

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
  if (!reminder.completedAt && new Date(reminder.nextRunAt).getTime() <= now)
    return 'due';
  if (!reminder.enabled) return reminder.completedAt ? 'completed' : 'paused';
  return new Date(reminder.nextRunAt).getTime() > now ? 'scheduled' : 'due';
}

/** Full schedule text is never shortened to fit the row. */
export function reminderScheduleLabel(
  reminder: ReminderEntity,
  now: number
): string {
  const state = reminderScheduleState(reminder, now);
  const timezone =
    reminder.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(reminder.nextRunAt));
  const recurrence =
    reminder.scheduleType === 'recurring'
      ? reminder.cron && !isCronRepresentable(reminder.cron)
        ? `Custom repeat: ${reminder.cron}`
        : describeReminderSchedule(scheduleFromRow(reminder))
      : undefined;
  const status = {
    scheduled: 'Scheduled',
    due: 'Due',
    paused: 'Paused',
    completed: 'Completed',
  }[state];
  const condition = reminder.emailFollowup
    ? reminder.emailFollowup.condition === 'if_no_reply'
      ? 'If no reply'
      : 'Regardless'
    : undefined;
  return [`${status}: ${date} (${timezone})`, recurrence, condition]
    .filter(Boolean)
    .join(' · ');
}
