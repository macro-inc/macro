import {
  type UseInfiniteQueryResult,
  useInfiniteQuery,
} from '@tanstack/solid-query';
import { SERVER_HOSTS } from 'core/constant/servers';
import { platformFetch } from 'core/util/platformFetch';
import type { BulkGetUserNotificationsByEventItemIdRequest } from 'service-notification/generated/schemas/bulkGetUserNotificationsByEventItemIdRequest';
import type { GetAllUserNotificationsResponse } from 'service-notification/generated/schemas/getAllUserNotificationsResponse';
import type { UserNotification } from 'service-notification/generated/schemas/userNotification';
import { createEffect, createMemo, createSelector } from 'solid-js';
import { unwrap } from 'solid-js/store';
import type { EntityData } from '../types/entity';
import type { Notification, WithNotification } from '../types/notification';
import { createApiTokenQuery } from './auth';
import type { EntityQuery } from './entity';
import { queryKeys } from './key';

const fetchPaginatedNotifications = async ({
  apiToken,
  cursor,
  limit = 20,
}: {
  apiToken?: string;
  cursor?: string;
  limit?: number;
}) => {
  if (!apiToken) throw new Error('No API token provided');
  const Authorization = `Bearer ${apiToken}`;

  const response = await platformFetch(
    `${SERVER_HOSTS['notification-service']}/user_notifications?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
    {
      headers: { Authorization },
    }
  );
  if (!response.ok)
    throw new Error('Failed to fetch notifications', { cause: response });

  const result: GetAllUserNotificationsResponse = await response.json();
  return result;
};

export function createNotificationsInfiniteQuery(args?: { limit?: number }) {
  const limit =
    args?.limit && args.limit > 0 && args.limit <= 500 ? args.limit : 20;
  const authQuery = createApiTokenQuery();
  return useInfiniteQuery(() => ({
    queryKey: queryKeys.notification({ infinite: true, limit }),
    queryFn: ({ pageParam }) =>
      fetchPaginatedNotifications({ apiToken: authQuery.data, ...pageParam }),
    initialPageParam: { limit },
    getNextPageParam: ({ next_cursor }) =>
      next_cursor ? { cursor: next_cursor, limit } : null,
    select: (data) => data.pages.flatMap(({ items }) => items),
    enabled: authQuery.isSuccess,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 10, // 10 minutes
  }));
}

const fetchEntityNotifications = async ({
  apiToken,
  cursor,
  limit = 20,
  eventItemIds,
}: {
  apiToken?: string;
  cursor?: string;
  limit?: number;
} & BulkGetUserNotificationsByEventItemIdRequest) => {
  if (!apiToken) throw new Error('No API token provided');
  const Authorization = `Bearer ${apiToken}`;

  const response = await platformFetch(
    `${SERVER_HOSTS['notification-service']}/user_notifications/item/bulk?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
    {
      method: 'POST',
      headers: { Authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventItemIds }),
    }
  );
  if (!response.ok)
    throw new Error('Failed to fetch entity notifications', {
      cause: response,
    });

  const result: GetAllUserNotificationsResponse = await response.json();
  return result;
};

export function createEntityNotificationsInfiniteQuery(args: {
  entityQueries: Array<EntityQuery>;
  limit?: number;
}) {
  const limit =
    args?.limit && args.limit > 0 && args.limit <= 500 ? args.limit : 20;
  const authQuery = createApiTokenQuery();
  const entityIds = createMemo<string[]>(() => {
    if (args.entityQueries.length === 0) return [];
    if (args.entityQueries.some((query) => !query.isSuccess)) return [];

    return args.entityQueries.flatMap((query) =>
      query.isSuccess ? query.data.map((entity) => entity.id) : []
    );
  });
  return useInfiniteQuery(() => ({
    queryKey: queryKeys.notification({
      infinite: true,
      limit,
      ids: entityIds(),
    }),
    queryFn: ({ pageParam }) =>
      fetchEntityNotifications({ apiToken: authQuery.data, ...pageParam }),
    initialPageParam: { limit, eventItemIds: entityIds() },
    getNextPageParam: ({ next_cursor }) =>
      next_cursor
        ? { cursor: next_cursor, limit, eventItemIds: entityIds() }
        : null,
    select: (data) => data.pages.flatMap(({ items }) => items),
    enabled: authQuery.isSuccess && entityIds().length > 0,
  }));
}

export function createUnseenNotifications(
  notificationsQuery: UseInfiniteQueryResult<UserNotification[]>
) {
  createEffect(() => {
    if (notificationsQuery.isSuccess) {
      if (notificationsQuery.hasNextPage && !notificationsQuery.isFetching) {
        notificationsQuery.fetchNextPage();
      }
    }
  });

  return createMemo<Notification[]>(() => {
    if (!notificationsQuery.isSuccess) return [];

    return notificationsQuery.data.flatMap((notification) => {
      if (notification.viewedAt) return [];

      return [notification];
    });
  });
}

export function createUnseenNotificationIds(
  notificationsQuery: UseInfiniteQueryResult<UserNotification[]>
) {
  const unseenNotifications = createUnseenNotifications(notificationsQuery);

  return createMemo<string[]>(() => {
    const unseen = unseenNotifications().flatMap((notification) => {
      if (notification.viewedAt) return [];

      return [notification.eventItemId];
    });

    return [...new Set(unseen)];
  });
}

export function createUnseenNotificationSelector(
  entityQueries: Array<EntityQuery>
) {
  const notificationsQuery = createEntityNotificationsInfiniteQuery({
    entityQueries,
  });
  const unseenNotificationIds = createUnseenNotificationIds(notificationsQuery);

  return createSelector(unseenNotificationIds, (id: string, unseenIds) =>
    unseenIds.includes(id)
  );
}

const fetchPaginatedEntityNotifications = async ({
  apiToken,
  cursor,
  eventItemId,
  limit = 20,
}: {
  apiToken?: string;
  cursor?: string;
  eventItemId: string;
  limit?: number;
}) => {
  if (!apiToken) throw new Error('No API token provided');
  const Authorization = `Bearer ${apiToken}`;

  const response = await platformFetch(
    `${SERVER_HOSTS['notification-service']}/user_notifications/item/${eventItemId}?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
    {
      headers: { Authorization },
    }
  );
  if (!response.ok)
    throw new Error('Failed to fetch email', { cause: response });

  const result: GetAllUserNotificationsResponse = await response.json();
  return result;
};

export function enhanceWithNotifications<T extends EntityData>(
  entity: T
): WithNotification<T> {
  const eventItemId = entity.id;
  const limit = 100;
  const authQuery = createApiTokenQuery();
  const notificationsQuery = useInfiniteQuery(() => ({
    queryKey: queryKeys.notification({ infinite: true, eventItemId, limit }),
    queryFn: ({ pageParam }) =>
      fetchPaginatedEntityNotifications({
        apiToken: authQuery.data,
        ...pageParam,
      }),
    initialPageParam: { eventItemId, limit },
    getNextPageParam: ({ next_cursor }) =>
      next_cursor ? { cursor: next_cursor, eventItemId, limit } : null,
    select: (data) => data.pages.flatMap(({ items }) => items),
    enabled: authQuery.isSuccess,
    gcTime: 1000 * 60 * 10, // 10 minutes
  }));

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
