import { useEntityNotificationsQuery } from '@queries/notification/user-notifications';
import { createEffect } from 'solid-js';
import { unwrap } from 'solid-js/store';
import type { EntityData } from '../types/entity';
import type { WithNotification } from '../types/notification';

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
                return b.createdAt - a.createdAt;
              })
          : [];
    },
  });
}
