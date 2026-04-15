import type { Maybe } from '@core/types';
import { type MaybeResult, throwOnErr } from '@core/util/maybeResult';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { notificationServiceClient } from '@service-notification/client';
import type { ApiUserNotification } from '@service-notification/generated/schemas/apiUserNotification';
import type { GetAllUserNotificationsResponse } from '@service-notification/generated/schemas/getAllUserNotificationsResponse';
import {
  type InfiniteData,
  type MutationFunction,
  useInfiniteQuery,
  useMutation,
} from '@tanstack/solid-query';
import { P, match } from 'ts-pattern';
import { queryClient } from '../client';
import { notificationKeys } from './keys';
import type { UnifiedNotification } from '@notifications/types';
import {
  type SoupEntityTag,
  optimisticUpdateSoupItemUpdatedAt,
} from '@queries/soup/normalized-cache';

function stripOwnerId({
  owner_id: _,
  ...rest
}: ApiUserNotification): UnifiedNotification {
  return rest;
}

export { notificationKeys } from './keys';

const DEFAULT_NOTIFICATION_LIMIT = 20;
const NOTIFICATION_STALE_TIME = 5 * 60 * 1000; // 5 minutes
const NOTIFICATION_GC_TIME = 10 * 60 * 1000; // 10 minutes

function normalizeLimit(limit?: number): number {
  return limit && limit > 0 && limit <= 500
    ? limit
    : DEFAULT_NOTIFICATION_LIMIT;
}

type UserNotificationsPageParam = { limit: number; cursor?: string };

function userNotificationsQueryOptions(limit: number) {
  return {
    queryKey: notificationKeys.user({ limit }).queryKey,
    queryFn: async ({
      pageParam,
    }: {
      pageParam: UserNotificationsPageParam;
    }) => {
      return await throwOnErr(
        async () =>
          await notificationServiceClient.userNotifications({
            limit: pageParam.limit,
            cursor: pageParam.cursor,
          })
      );
    },
    initialPageParam: { limit } as UserNotificationsPageParam,
    getNextPageParam: (lastPage: GetAllUserNotificationsResponse) =>
      lastPage.next_cursor ? { cursor: lastPage.next_cursor, limit } : null,
    staleTime: NOTIFICATION_STALE_TIME,
    gcTime: NOTIFICATION_GC_TIME,
  };
}

/** Paginated query for all notifications for the current user. */
export function useUserNotificationsQuery(args?: { limit?: number }) {
  const limit = normalizeLimit(args?.limit);

  return useInfiniteQuery(() => ({
    ...userNotificationsQueryOptions(limit),
    select: (
      data: InfiniteData<
        GetAllUserNotificationsResponse,
        UserNotificationsPageParam
      >
    ) => data.pages.flatMap(({ items }) => items.map(stripOwnerId)),
  }));
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
export function useEntityNotificationsQuery(args: {
  eventItemId: () => string;
  limit?: number;
}) {
  const limit = normalizeLimit(args.limit);

  return useInfiniteQuery(() => ({
    ...entityNotificationsQueryOptions(args.eventItemId(), limit),
    select: (
      data: InfiniteData<
        GetAllUserNotificationsResponse,
        EntityNotificationsPageParam
      >
    ) => data.pages.flatMap(({ items }) => items.map(stripOwnerId)),
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
export function useEntitiesNotificationsQuery(args: {
  eventItemIds: () => string[];
  limit?: number;
}) {
  const limit = normalizeLimit(args.limit);

  return useInfiniteQuery(() => ({
    ...entitiesNotificationsQueryOptions(args.eventItemIds(), limit),
    select: (
      data: InfiniteData<
        GetAllUserNotificationsResponse,
        EntitiesNotificationsPageParam
      >
    ) => data.pages.flatMap(({ items }) => items.map(stripOwnerId)),
    enabled: args.eventItemIds().length > 0,
  }));
}

export function invalidateUserNotifications() {
  return queryClient.invalidateQueries({
    queryKey: notificationKeys.user._def,
  });
}

export function invalidateEntityNotifications(eventItemId: string) {
  return queryClient.invalidateQueries({
    queryKey: [...notificationKeys.entity._def, eventItemId],
  });
}

export function invalidateAllNotifications() {
  return queryClient.invalidateQueries({
    queryKey: notificationKeys._def,
  });
}

type NotificationsMutationParams = {
  notificationIds: string[];
};

type NotificationData<T> = InfiniteData<GetAllUserNotificationsResponse, T>;

type NotificationsMutationContext = {
  /**
   * Snapshot of all cached `notificationKeys.user(...)` queries so we can rollback
   * optimistic updates regardless of what limit a caller used.
   */
  previousData: Array<
    readonly [unknown, NotificationData<UserNotificationsPageParam> | undefined]
  >;
};

type UpdaterWithParams<T, P> = (input: Maybe<T>, params: P) => Maybe<T>;

type NotificationsUpdater = UpdaterWithParams<
  NotificationData<UserNotificationsPageParam>,
  NotificationsMutationParams
>;

type NotificationsMutationCallbacks<T> = MutationCallbacks<
  T,
  Error,
  NotificationsMutationParams,
  NotificationsMutationContext
>;

type NotificationsMutationFn<T> = MutationFunction<
  MaybeResult<string, T>,
  NotificationsMutationParams
>;

type NotificationsOnMutateFn = (
  variables: NotificationsMutationParams
) => Promise<NotificationsMutationContext>;

function notificationsMutationSuccessCallback<T>(
  _: T,
  _params: NotificationsMutationParams
) {
  queryClient.invalidateQueries({
    queryKey: notificationKeys.user._def,
  });
}

/** Creates an optimistic update handler that snapshots previous data for rollback. */
function createNotificationsMutateFn(
  updaterFn: NotificationsUpdater
): NotificationsOnMutateFn {
  return async (params) => {
    await queryClient.cancelQueries({
      queryKey: notificationKeys.user._def,
    });

    const previousData = queryClient.getQueriesData<
      NotificationData<UserNotificationsPageParam>
    >({
      queryKey: notificationKeys.user._def,
    });

    queryClient.setQueriesData(
      { queryKey: notificationKeys.user._def },
      (input) =>
        updaterFn(
          input as Maybe<NotificationData<UserNotificationsPageParam>>,
          params
        )
    );

    return { previousData };
  };
}

function createNotificationsMutation<T>(
  mutationFn: NotificationsMutationFn<T>,
  parentCallbacks?: NotificationsMutationCallbacks<T>
) {
  return (callbacks?: NotificationsMutationCallbacks<T>) => {
    return useMutation(() => ({
      mutationFn: async (params, ctx) =>
        await throwOnErr(async () => await mutationFn(params, ctx)),
      ...withCallbacks<
        T,
        Error,
        NotificationsMutationParams,
        NotificationsMutationContext
      >(
        {
          onSuccess: notificationsMutationSuccessCallback,
        },
        { ...parentCallbacks, ...callbacks }
      ),
    }));
  };
}

function notificationsMutationErrorFn(
  _: Error,
  _params: NotificationsMutationParams,
  context: NotificationsMutationContext
) {
  for (const [queryKey, data] of context.previousData) {
    queryClient.setQueryData(
      queryKey as readonly unknown[],
      data as NotificationData<UserNotificationsPageParam> | undefined
    );
  }
}

const mapNotificationsAsSeen = (
  input: Maybe<NotificationData<UserNotificationsPageParam>>,
  params: NotificationsMutationParams
) => {
  return (
    input && {
      ...input,
      pages: input.pages.map((page) => ({
        ...page,
        items: page.items.map((n) =>
          params.notificationIds.includes(n.id)
            ? { ...n, viewed_at: new Date().toISOString() }
            : n
        ),
      })),
    }
  );
};

/** Marks notifications as seen with optimistic update. */
export const useMarkNotificationsAsSeenMutation = createNotificationsMutation(
  async (params: NotificationsMutationParams) =>
    await notificationServiceClient.bulkMarkNotificationAsSeen({
      notificationIds: params.notificationIds,
    }),
  {
    onMutate: createNotificationsMutateFn(mapNotificationsAsSeen),
    onError: notificationsMutationErrorFn,
  }
);

const filterOutDoneNotifications = (
  input: Maybe<NotificationData<UserNotificationsPageParam>>,
  params: NotificationsMutationParams
) => {
  return (
    input && {
      ...input,
      pages: input.pages.map((page) => ({
        ...page,
        items: page.items.filter((n) => !params.notificationIds.includes(n.id)),
      })),
    }
  );
};

/** Marks notifications as done (removes from list) with optimistic update. */
export const useMarkNotificationsAsDoneMutation = createNotificationsMutation(
  async (params: NotificationsMutationParams) =>
    await notificationServiceClient.bulkMarkNotificationAsDone({
      notificationIds: params.notificationIds,
    }),
  {
    onMutate: createNotificationsMutateFn(filterOutDoneNotifications),
    onError: notificationsMutationErrorFn,
  }
);

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

function notificationEntityTypeToSoupTag(
  entityType: UnifiedNotification['entity_type']
): SoupEntityTag | null {
  return match(entityType)
    .with('document', () => 'document' as const)
    .with('chat', () => 'chat' as const)
    .with('channel', () => 'channel' as const)
    .with('project', () => 'project' as const)
    .with('email_thread', () => 'emailThread' as const)
    .with(P.union('user', 'team', 'call'), () => null)
    .exhaustive();
}

export function optimisticInsertNotification(
  notification: UnifiedNotification
) {
  const item = notification as NotificationItem;
  const soupTag = notificationEntityTypeToSoupTag(notification.entity_type);

  queryClient.setQueriesData<NotificationData<UserNotificationsPageParam>>(
    { queryKey: notificationKeys.user._def },
    (data) => {
      if (!data) return data;

      const exists = data.pages.some((page) =>
        page.items.some((n) => n.id === item.id)
      );
      if (exists) return data;

      return {
        ...data,
        pages: data.pages.map((page, index) =>
          index === 0 ? { ...page, items: [item, ...page.items] } : page
        ),
      };
    }
  );

  if (soupTag && notification.created_at) {
    optimisticUpdateSoupItemUpdatedAt(
      notification.entity_id,
      soupTag,
      notification.created_at
    );
  }

  invalidateUserNotifications();
}
