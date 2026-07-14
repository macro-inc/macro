import type { Entity } from '@core/types';

import { notificationServiceClient } from '@service-notification/client';
import type { ApiUserNotification } from '@service-notification/generated/schemas';

type UnifiedNotification = Omit<ApiUserNotification, 'ownerId'>;

export const fetchNotificationsForEntities = async (
  entities: Entity[]
): Promise<UnifiedNotification[]> => {
  const eventItemIds = entities.map((entity) => entity.id);
  const result =
    await notificationServiceClient.bulkGetUserNotificationsByEventItemId({
      limit: 500,
      eventItemIds,
    });

  if (result.isErr()) {
    console.error(
      'failed to fetch notifications for specific event item ids',
      result.error
    );
    return [];
  }

  return result.value.items;
};
