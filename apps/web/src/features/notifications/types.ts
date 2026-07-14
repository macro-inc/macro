import type { Entity, EntityType } from '@core/types';
import type { ApiUserNotification } from '@service-notification/generated/schemas';
import { listTypedNotificationsResponse } from '@service-notification/generated/zod';

export type UnifiedNotification = Omit<ApiUserNotification, 'owner_id'>;

const _baseSchema = listTypedNotificationsResponse.shape.items.element;
const _entitySchema = _baseSchema._def.left;
const _allOfSchema = _baseSchema._def.right;
export const unifiedNotificationSchema = _entitySchema.and(
  _allOfSchema.omit({ owner_id: true })
);

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
