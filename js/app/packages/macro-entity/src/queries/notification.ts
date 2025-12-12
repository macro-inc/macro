import {
  useEntityNotificationsQuery,
} from '@queries/notification/user-notifications';
import { createEffect } from 'solid-js';
import { unwrap } from 'solid-js/store';
import type { EntityData } from '../types/entity';
import type { WithNotification } from '../types/notification';

export {
  invalidateAllNotifications,
  invalidateEntityNotifications,
  invalidateUserNotifications,
  notificationKeys,
  useEntitiesNotificationsQuery,
  useEntityNotificationsQuery,
  useUserNotificationsQuery,
} from '@queries/notification/user-notifications';

/**
 * Enhances an entity with its notifications as an accessor.
 */
export function enhanceWithNotifications<T extends EntityData>(
  entity: T
): WithNotification<T> {
  const eventItemId = entity.id;
  const limit = 100;

  const notificationsQuery = useEntityNotificationsQuery({
    eventItemId: () => eventItemId,
    limit,
  });

  createEffect(() => {
    if (notificationsQuery.isSuccess) {
      if (notificationsQuery.hasNextPage && !notificationsQuery.isFetching) {
        notificationsQuery.fetchNextPage();
      }
    }
  });

  return Object.assign(unwrap(entity), {
    get notifications() {
      return () =>
        notificationsQuery.isSuccess
          ? notificationsQuery.data
            .filter(({ viewedAt }) => !viewedAt)
            .toSorted((a, b) => {
              if (a.isImportantV0 && b.isImportantV0) {
                return b.createdAt - a.createdAt;
              } else if (a.isImportantV0) {
                return -1;
              } else if (b.isImportantV0) {
                return 1;
              }

              return b.createdAt - a.createdAt;
            })
          : [];
    },
  });
}
