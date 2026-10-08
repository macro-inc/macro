import type { Accessor } from 'solid-js';
import type { EntityData } from '../types/entity';
import type { Notification, WithNotification } from '../types/notification';
import { notificationIsRead } from './notification';

/**
 * GraphQL soup rows attach a raw array; list surfaces wrap it as an accessor.
 * Read either shape so an unwrapped row cannot throw during render.
 */
function attachedNotifications(entity: {
  notifications?: Accessor<Notification[] | undefined> | Notification[];
}): Notification[] | undefined {
  const attached = entity.notifications;
  if (typeof attached === 'function') return attached() ?? undefined;
  if (Array.isArray(attached)) return attached;
  return undefined;
}

export function unreadFilterFn(entity: WithNotification<EntityData>) {
  const notifications = attachedNotifications(entity);
  if (entity.type === 'email') {
    return (
      !entity.isRead ||
      (notifications?.some(
        (n) =>
          n.notification_event_type === 'reminder' && !notificationIsRead(n)
      ) ??
        false)
    );
  }
  return notifications?.some((n) => !notificationIsRead(n)) ?? false;
}
