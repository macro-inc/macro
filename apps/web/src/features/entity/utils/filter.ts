import type { EntityData } from '../types/entity';
import type { WithNotification } from '../types/notification';
import { notificationIsRead } from './notification';

export function unreadFilterFn(entity: WithNotification<EntityData>) {
  if (entity.type === 'email') {
    return (
      !entity.isRead ||
      (entity
        .notifications?.()
        ?.some(
          (n) =>
            n.notification_event_type === 'reminder' && !notificationIsRead(n)
        ) ??
        false)
    );
  }
  return entity.notifications?.()?.some((n) => !notificationIsRead(n)) ?? false;
}
