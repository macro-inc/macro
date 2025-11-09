import type { Entity } from '@core/types';
import { isErr } from '@core/util/maybeResult';
import { notificationServiceClient } from '@service-notification/client';
import type { UserNotification } from '@service-notification/generated/schemas';

type UnifiedNotification = Omit<UserNotification, 'ownerId'>;

export const fetchNotificationsForEntities = async (
  entities: Entity[]
): Promise<UnifiedNotification[]> => {
  const eventItemIds = entities.map((entity) => entity.id);
  const result =
    await notificationServiceClient.bulkGetUserNotificationsByEventItemId({
      limit: 500,
      eventItemIds,
    });

  if (isErr(result)) {
    console.error(
      'failed to fetch notifications for specific event item ids',
      result[0]
    );
    return [];
  }

  return result[1].items;
};
