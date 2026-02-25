import type { EntityData } from '../types/entity';
import type { WithNotification } from '../types/notification';

export function unreadFilterFn(entity: WithNotification<EntityData>) {
  if (entity.type === 'email') return !entity.isRead;
  return entity.notifications?.()?.some(({ viewed_at }) => !viewed_at) ?? false;
}
