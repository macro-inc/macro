import type { UnifiedNotification } from '@notifications/types';
import type { ReminderAlert } from '../core/reminder-alert';

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
    const content = metadata.content;
    if (!content || typeof content.reminderId !== 'string') continue;
    const timestamp = content.scheduledFor
      ? Date.parse(content.scheduledFor)
      : NaN;
    const scheduledFor = Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString()
      : undefined;
    const key = scheduledFor
      ? `${content.reminderId}@${scheduledFor}`
      : notification.id;

    // A replay of an occurrence already acknowledged elsewhere must not alert.
    if (notification.state !== 'unseen') {
      acknowledged.add(key);
      continue;
    }
    alerts.set(key, {
      key,
      reminderId: content.reminderId,
      description:
        typeof content.description === 'string' && content.description.trim()
          ? content.description
          : 'Reminder',
      scheduledFor,
    });
  }

  return [...alerts.values()].filter((alert) => !acknowledged.has(alert.key));
}
