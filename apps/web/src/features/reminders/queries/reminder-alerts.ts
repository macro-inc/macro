import type { UnifiedNotification } from '@notifications/types';
import type { ReminderAlert } from '../core/reminder-alert';

/** Match an occurrence across query snapshots and replayed live deliveries. */
export function reminderAlertIdentity(notification: UnifiedNotification) {
  const metadata = notification.notification_metadata;
  if (!metadata || metadata.tag !== 'reminder') return;
  const content = metadata.content;
  if (!content || typeof content.reminderId !== 'string') return;
  const timestamp = content.scheduledFor
    ? Date.parse(content.scheduledFor)
    : NaN;
  const scheduledFor = Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : undefined;
  return {
    key: scheduledFor
      ? `${content.reminderId}@${scheduledFor}`
      : notification.id,
    reminderId: content.reminderId,
    scheduledFor,
  };
}

/** Use delivered notifications so an edited schedule cannot invent a firing. */
export function reminderAlertsFromNotifications(
  notifications: readonly UnifiedNotification[]
): ReminderAlert[] {
  const alerts = new Map<string, ReminderAlert>();
  const acknowledged = new Set<string>();

  for (const notification of notifications) {
    const metadata = notification.notification_metadata;
    if (!metadata || metadata.tag !== 'reminder' || notification.deleted_at)
      continue;
    // The websocket source admits unknown metadata for forward compatibility.
    const identity = reminderAlertIdentity(notification);
    if (!identity) continue;
    const { key } = identity;
    const content = metadata.content;

    // A replay of an occurrence already acknowledged elsewhere must not alert.
    if (notification.state !== 'unseen') {
      acknowledged.add(key);
      continue;
    }
    alerts.set(key, {
      ...identity,
      description:
        typeof content.description === 'string' && content.description.trim()
          ? content.description
          : 'Reminder',
    });
  }

  return [...alerts.values()].filter((alert) => !acknowledged.has(alert.key));
}
