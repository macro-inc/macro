import { notificationIsRead } from '@notifications';
import type { EntityData } from '../types/entity';
import type { WithNotification } from '../types/notification';

export function unreadFilterFn(entity: WithNotification<EntityData>) {
  if (entity.type === 'email') return !entity.isRead;
  return entity.notifications?.()?.some((n) => !notificationIsRead(n)) ?? false;
}
