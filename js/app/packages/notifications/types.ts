import type { Entity, EntityType } from '@core/types';
import type { ApiUserNotification } from '@service-notification/generated/schemas';

export type UnifiedNotification = Omit<ApiUserNotification, 'ownerId'>;

export type CompositeEntity = `${EntityType}@${string}`;

export function compositeEntity(entity: Entity): CompositeEntity {
  return `${entity.type}@${entity.id}`;
}

export function notificationEntity(notification: UnifiedNotification): Entity {
  return {
    id: notification.entity_id,
    type: notification.entity_type as EntityType,
  };
}
