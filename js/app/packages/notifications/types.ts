import type { Entity, EntityType } from '@core/types';
import type { UserNotification } from '@service-notification/generated/schemas';

export type UnifiedNotification = Omit<UserNotification, 'ownerId'>;

export type CompositeEntity = `${EntityType}@${string}`;

export function compositeEntity(entity: Entity): CompositeEntity {
  return `${entity.type}@${entity.id}`;
}

export function notificationEntity(notification: UnifiedNotification): Entity {
  return {
    id: notification.eventItemId,
    type: notification.eventItemType as EntityType,
  };
}
