import type { Entity, EntityType } from '@core/types';
import type {
  ApiUserNotification,
  EntityType as NotificationEntityType,
} from '@service-notification/generated/schemas';
import { getListTypedNotificationsResponseSchema } from '@service-notification/generated/zod';

export type UnifiedNotification = Omit<ApiUserNotification, 'owner_id'>;

function createUnifiedNotificationSchema() {
  const base = getListTypedNotificationsResponseSchema().shape.items.element;
  return base._def.left.and(base._def.right.omit({ owner_id: true }));
}
let unifiedSchema:
  | ReturnType<typeof createUnifiedNotificationSchema>
  | undefined;
export function getUnifiedNotificationSchema() {
  unifiedSchema ??= createUnifiedNotificationSchema();
  return unifiedSchema;
}

type NotificationEntity = { id: string; type: NotificationEntityType };

export type CompositeEntity =
  `${EntityType | NotificationEntityType}@${string}`;

export function compositeEntity(
  entity: Entity | NotificationEntity
): CompositeEntity {
  return `${entity.type}@${entity.id}`;
}

export function notificationEntity(
  notification: UnifiedNotification
): NotificationEntity {
  return {
    id: notification.entity_id,
    type: notification.entity_type,
  };
}
