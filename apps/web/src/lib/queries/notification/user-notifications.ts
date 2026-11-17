import { throwOnErr } from '@core/util/result';
import type { UnifiedNotification } from '@notifications/types';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { notificationServiceClient } from '@service-notification/client';
import type { ApiUserNotification } from '@service-notification/generated/schemas/apiUserNotification';
import type { GetAllUserNotificationsResponse } from '@service-notification/generated/schemas/getAllUserNotificationsResponse';
import type { NotificationUpdateOperation } from '@service-storage/graphql/generated/graphql';
import { updateNotifications } from '@service-storage/graphql-notifications';
import { graphqlCacheEnabled } from '@service-storage/graphql-soup';
import { createLazyMemo } from '@solid-primitives/memo';
import { type InfiniteData, useInfiniteQuery } from '@tanstack/solid-query';
import { type Accessor, createSignal, untrack } from 'solid-js';
import { queryClient } from '../client';
import {
  createGraphqlNotificationsQuery,
  createGraphqlUpdateNotificationsMutation,
  type UpdateNotificationsResult,
} from './graphql/user-notifications';
import { notificationKeys } from './keys';

function stripOwnerId({
  owner_id: _,
  ...rest
}: ApiUserNotification): UnifiedNotification {
  return rest;
}

// Cached selectors outlive the hooks that pass them; keep hook scope out.
function selectNotificationItems(
  data: InfiniteData<GetAllUserNotificationsResponse, unknown>
): UnifiedNotification[] {
  return data.pages.flatMap(({ items }) => items.map(stripOwnerId));
}

const DEFAULT_NOTIFICATION_LIMIT = 20;
const NOTIFICATION_GC_TIME = 10 * 60 * 1000; // 10 minutes

function normalizeLimit(limit?: number): number {
  return limit && limit > 0 && limit <= 500
    ? limit
    : DEFAULT_NOTIFICATION_LIMIT;
}

/** Arguments for the current user's notification query. */
export type UserNotificationsQueryArgs = {
  limit?: number;
};

/** Reactive options for the current user's notification query. */
export type UserNotificationsQueryOptions = {
  enabled?: boolean;
};

/** Query state exposed by the notification feed facade. */
export type UserNotificationsQuery = {
  /** Reactively reports whether a data/status reader has started the feed. */
  readonly isStarted: boolean;
  readonly data: UnifiedNotification[] | undefined;
  readonly error: Error | null;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isFetchingNextPage: boolean;
  readonly hasNextPage: boolean;
  fetchNextPage(): Promise<void>;
  refetch(): Promise<void>;
};

/**
 * Paginated query for the current user's active notifications, read from the
 * GraphQL Soup query's notification fragment. The feed is built only when a
 * data/status reader first needs it.
 */
export function useUserNotificationsQuery(
  args: Accessor<UserNotificationsQueryArgs>,
  options?: Accessor<UserNotificationsQueryOptions>
): UserNotificationsQuery {
  const [started, setStarted] = createSignal(false);
  const query = createLazyMemo(() =>
    untrack(() => {
      const graphqlQuery = createGraphqlNotificationsQuery(args, () => ({
        enabled: options?.().enabled !== false,
      }));
      setStarted(true);
      return graphqlQuery;
    })
  );

  return {
    get isStarted() {
      return started();
    },
    get data() {
      return query().data;
    },
    get error() {
      return query().error;
    },
    get isLoading() {
      return query().isLoading;
    },
    get isFetching() {
      return query().isFetching;
    },
    get isFetchingNextPage() {
      return query().isFetchingNextPage;
    },
    get hasNextPage() {
      return query().hasNextPage;
    },
    async fetchNextPage() {
      await query().fetchNextPage();
    },
    async refetch() {
      await query().refetch({
        requestPolicy: 'network-only',
        throwOnError: true,
      });
    },
  };
}

type EntityNotificationsPageParam = {
  eventItemId: string;
  limit: number;
  cursor?: string;
};

function entityNotificationsQueryOptions(eventItemId: string, limit: number) {
  return {
    queryKey: notificationKeys.entity({ eventItemId, limit }).queryKey,
    queryFn: async ({
      pageParam,
    }: {
      pageParam: EntityNotificationsPageParam;
    }) => {
      return await throwOnErr(
        async () =>
          await notificationServiceClient.bulkGetUserNotificationsByEventItemId(
            {
              eventItemIds: [pageParam.eventItemId],
              limit: pageParam.limit,
              cursor: pageParam.cursor,
            }
          )
      );
    },
    initialPageParam: { eventItemId, limit } as EntityNotificationsPageParam,
    getNextPageParam: (lastPage: GetAllUserNotificationsResponse) =>
      lastPage.next_cursor
        ? { cursor: lastPage.next_cursor, eventItemId, limit }
        : null,
    gcTime: NOTIFICATION_GC_TIME,
  };
}

/** Paginated query for notifications for a single entity. */
function _useEntityNotificationsQuery(args: {
  eventItemId: () => string;
  limit?: number;
}) {
  const limit = normalizeLimit(args.limit);

  return useInfiniteQuery(() => ({
    ...entityNotificationsQueryOptions(args.eventItemId(), limit),
    select: selectNotificationItems,
  }));
}

type EntitiesNotificationsPageParam = {
  eventItemIds: string[];
  limit: number;
  cursor?: string;
};

function entitiesNotificationsQueryOptions(
  eventItemIds: string[],
  limit: number
) {
  return {
    queryKey: notificationKeys.entities({ eventItemIds, limit }).queryKey,
    queryFn: async ({
      pageParam,
    }: {
      pageParam: EntitiesNotificationsPageParam;
    }) => {
      return await throwOnErr(
        async () =>
          await notificationServiceClient.bulkGetUserNotificationsByEventItemId(
            {
              eventItemIds: pageParam.eventItemIds,
              limit: pageParam.limit,
              cursor: pageParam.cursor,
            }
          )
      );
    },
    initialPageParam: { limit, eventItemIds } as EntitiesNotificationsPageParam,
    getNextPageParam: (lastPage: GetAllUserNotificationsResponse) =>
      lastPage.next_cursor
        ? { cursor: lastPage.next_cursor, limit, eventItemIds }
        : null,
  };
}

/** Paginated query for notifications across multiple entities. */
function _useEntitiesNotificationsQuery(args: {
  eventItemIds: () => string[];
  limit?: number;
}) {
  const limit = normalizeLimit(args.limit);

  return useInfiniteQuery(() => ({
    ...entitiesNotificationsQueryOptions(args.eventItemIds(), limit),
    select: selectNotificationItems,
    enabled: args.eventItemIds().length > 0,
  }));
}

async function refreshSoupAfterUncachedGraphqlWrite(): Promise<void> {
  if (!graphqlCacheEnabled()) {
    await refreshActiveGraphqlSoupQueries();
  }
}

/** Mark notifications done through the shared GraphQL mutation. Throws on failure. */
export async function bulkMarkNotificationsAsDone(
  notificationIds: string[]
): Promise<void> {
  await updateNotifications({ notificationIds, operation: 'MARK_DONE' });
}

/** Mark notifications undone through the shared GraphQL mutation. Throws on failure. */
export async function bulkMarkNotificationsAsUndone(
  notificationIds: string[]
): Promise<void> {
  await updateNotifications({ notificationIds, operation: 'MARK_UNDONE' });
}

/**
 * Fetch the ids of the given event items' DONE notifications from the server.
 * The live user-notifications stream only carries not-done notifications, so
 * a done thread's ids age out of the local cache — mark-not-done resolves
 * them server-side to restore reliably. Throws on failure.
 */
export async function fetchDoneNotificationIdsByEventItemIds(
  eventItemIds: string[]
): Promise<string[]> {
  if (eventItemIds.length === 0) return [];
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const response = await throwOnErr(
      async () =>
        await notificationServiceClient.bulkGetUserNotificationsByEventItemId({
          eventItemIds,
          // Server max page size; bulk selections can span many threads, so
          // follow the cursor through every page rather than capping.
          limit: 500,
          states: ['done'],
          cursor,
        })
    );
    ids.push(...response.items.map((n) => n.id));
    cursor = response.next_cursor ?? undefined;
  } while (cursor);
  return ids;
}

export function invalidateEntityNotifications(eventItemId: string) {
  return queryClient.invalidateQueries({
    queryKey: [...notificationKeys.entity._def, eventItemId],
  });
}

function _invalidateAllNotifications() {
  return queryClient.invalidateQueries({
    queryKey: notificationKeys._def,
  });
}

type NotificationsMutationParams = {
  notificationIds: string[];
};

/** Notification status mutation exposed to consumers. */
export type NotificationsMutation = {
  readonly isPending: boolean;
  readonly error: Error | null;
  mutate(variables: NotificationsMutationParams): void;
  mutateAsync(
    variables: NotificationsMutationParams
  ): Promise<UpdateNotificationsResult>;
};

function createNotificationsMutation(operation: NotificationUpdateOperation) {
  return (): NotificationsMutation => {
    const graphqlMutation = createGraphqlUpdateNotificationsMutation({
      operation,
      // The normalized client propagates the optimistic notification row
      // into active Soup edges. Its uncached fallback cannot, so refetch
      // mounted Soup queries after the authoritative mutation succeeds.
      onSuccess: refreshSoupAfterUncachedGraphqlWrite,
    });

    return {
      get isPending() {
        return graphqlMutation.isPending;
      },
      get error() {
        return graphqlMutation.error;
      },
      mutate(variables) {
        graphqlMutation.mutate(variables);
      },
      async mutateAsync(variables) {
        const result = await graphqlMutation.mutateAsync(variables);
        if (result.error) throw result.error;
        if (!result.data) {
          throw new Error('updateNotifications mutation returned no data');
        }
        return result.data.updateNotifications;
      },
    };
  };
}

/** Marks notifications as seen. */
export const useMarkNotificationsAsSeenMutation =
  createNotificationsMutation('MARK_SEEN');

/** Marks notifications as done. */
export const useMarkNotificationsAsDoneMutation =
  createNotificationsMutation('MARK_DONE');

type NotificationItem = GetAllUserNotificationsResponse['items'][number];

/**
 * Lookup a notification by id via the notification-service.
 */
export async function getNotificationById(
  notificationId: string
): Promise<UnifiedNotification | undefined> {
  const res = await throwOnErr(async () => {
    return await notificationServiceClient.getUserNotificationById(
      notificationId
    );
  });

  if (!res) return undefined;
  return stripOwnerId(res as NotificationItem);
}
