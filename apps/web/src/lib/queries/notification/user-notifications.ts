import type { Maybe } from '@core/types';
import { throwOnErr } from '@core/util/result';
import {
  nextNotificationState,
  notificationStatesForFilter,
} from '@notifications/notification-state';
import type { UnifiedNotification } from '@notifications/types';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
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
import { updateSoupForNotification } from './notification-soup';

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
const NOTIFICATION_STALE_TIME = 5 * 60 * 1000; // 5 minutes
const NOTIFICATION_GC_TIME = 10 * 60 * 1000; // 10 minutes

// Websocket-inserted notifications young enough that a fetch snapshot may
// predate them: a full refetch reads its pages over several seconds and
// commits atomically, so a snapshot begun before the insert lands without
// the row and would silently drop it from the cache. A query-cache
// subscription re-prepends tracked rows after every non-manual success
// commit (solid-query hard-disables structuralSharing, so a commit-time
// merge hook is not available). Entries retire by TTL, realtime delete, or
// done removal — not by cache containment, since our own optimistic writes
// also contain the row and are not server confirmation.
const UNCONFIRMED_INSERT_TTL_MS = 5 * 60 * 1000;
const MAX_UNCONFIRMED_INSERTS = 200;
const unconfirmedInserts = new Map<
  string,
  { item: NotificationItem; insertedAt: number }
>();

let unconfirmedInsertsSubscribed = false;

// Subscribed lazily on the first tracked insert so importing this module
// never touches the query client (test setups mock it after import).
function ensureUnconfirmedInsertReapply() {
  if (unconfirmedInsertsSubscribed || typeof window === 'undefined') return;
  unconfirmedInsertsSubscribed = true;
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    const action = event.action as { type: string; manual?: boolean };
    if (action.type !== 'success' || action.manual) return;
    const key = event.query.queryKey;
    if (!Array.isArray(key) || key[0] !== 'notification' || key[1] !== 'user')
      return;
    reapplyUnconfirmedInserts(key);
  });
}

function trackUnconfirmedInsert(item: NotificationItem) {
  ensureUnconfirmedInsertReapply();
  unconfirmedInserts.delete(item.id);
  unconfirmedInserts.set(item.id, { item, insertedAt: Date.now() });
  while (unconfirmedInserts.size > MAX_UNCONFIRMED_INSERTS) {
    const oldest = unconfirmedInserts.keys().next().value;
    if (oldest === undefined) break;
    unconfirmedInserts.delete(oldest);
  }
}

function retireUnconfirmedInserts(ids: Iterable<string>) {
  for (const id of ids) unconfirmedInserts.delete(id);
}

function pruneExpiredUnconfirmedInserts() {
  const now = Date.now();
  for (const [id, entry] of unconfirmedInserts) {
    if (now - entry.insertedAt > UNCONFIRMED_INSERT_TTL_MS) {
      unconfirmedInserts.delete(id);
    }
  }
}

function reapplyUnconfirmedInserts(queryKey: readonly unknown[]) {
  pruneExpiredUnconfirmedInserts();
  if (unconfirmedInserts.size === 0) return;
  queryClient.setQueryData<NotificationData<UserNotificationsPageParam>>(
    queryKey,
    (data) => {
      if (!data?.pages?.length) return data;
      const presentIds = new Set(
        data.pages.flatMap((page) => page.items.map((n) => n.id))
      );
      const missing = [...unconfirmedInserts.values()]
        .map((entry) => entry.item)
        .filter(
          (item) =>
            !presentIds.has(item.id) &&
            (item.state === 'done') === notificationQueryWantsDone(queryKey)
        );
      if (missing.length === 0) return data;
      return {
        ...data,
        pages: data.pages.map((page, index) =>
          index === 0 ? { ...page, items: [...missing, ...page.items] } : page
        ),
      };
    }
  );
}

function normalizeLimit(limit?: number): number {
  return limit && limit > 0 && limit <= 500
    ? limit
    : DEFAULT_NOTIFICATION_LIMIT;
}

type UserNotificationsPageParam = { limit: number; cursor?: string };

function userNotificationsQueryOptions(limit: number, done?: boolean) {
  return {
    queryKey: notificationKeys.user({ limit, done }).queryKey,
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
            states: notificationStatesForFilter('done', done ?? false),
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

/** Arguments for the current user's notification query. */
export type UserNotificationsQueryArgs = {
  limit?: number;
  done?: boolean;
};

/** Reactive options for the current user's notification query. */
export type UserNotificationsQueryOptions = {
  enabled?: boolean;
};

/** Query state exposed by the transport-neutral notification facade. */
export type UserNotificationsQuery = {
  /** Reactively reports data/status activation of the GraphQL feed (REST is eager). */
  readonly isStarted: boolean;
  readonly data: UnifiedNotification[] | undefined;
  readonly error: Error | null;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isFetchingNextPage: boolean;
  readonly hasNextPage: boolean;
  readonly transport: 'rest' | 'graphql';
  fetchNextPage(): Promise<void>;
  refetch(): Promise<void>;
};

/** REST implementation kept private behind {@link useUserNotificationsQuery}. */
function useRestUserNotificationsQuery(
  args: Accessor<UserNotificationsQueryArgs>,
  options?: Accessor<UserNotificationsQueryOptions>
) {
  return useInfiniteQuery(() => {
    const queryArgs = args();
    const limit = normalizeLimit(queryArgs.limit);
    return {
      ...userNotificationsQueryOptions(limit, queryArgs.done),
      select: selectNotificationItems,
      enabled: options?.().enabled,
      // Always refetch in the case of a stale browser tab
      refetchOnWindowFocus: 'always' as const,
    };
  });
}

/**
 * Paginated query for the current user's notifications.
 *
 * Active notifications come from the GraphQL Soup query's notification
 * fragment. Done-history queries retain REST pagination because Soup
 * notification edges only return active records.
 */
export function useUserNotificationsQuery(
  args: Accessor<UserNotificationsQueryArgs>,
  options?: Accessor<UserNotificationsQueryOptions>
): UserNotificationsQuery {
  const queryEnabled = () => options?.().enabled !== false;
  const usesGraphql = () => args().done !== true;

  const [graphqlStarted, setGraphqlStarted] = createSignal(false);
  const graphqlQuery = createLazyMemo(() =>
    untrack(() => {
      const query = createGraphqlNotificationsQuery(args, () => ({
        enabled: queryEnabled() && usesGraphql(),
      }));
      setGraphqlStarted(true);
      return query;
    })
  );

  const restQuery = useRestUserNotificationsQuery(args, () => ({
    enabled: queryEnabled() && !usesGraphql(),
  }));

  const refetch = async () => {
    if (usesGraphql()) {
      await graphqlQuery().refetch({
        requestPolicy: 'network-only',
        throwOnError: true,
      });
    } else {
      const result = await restQuery.refetch();
      if (result.error) throw result.error;
    }
  };

  return {
    get isStarted() {
      return !usesGraphql() || graphqlStarted();
    },
    get data() {
      return usesGraphql() ? graphqlQuery().data : restQuery.data;
    },
    get error() {
      return usesGraphql()
        ? graphqlQuery().error
        : ((restQuery.error as Error | null) ?? null);
    },
    get isLoading() {
      return usesGraphql() ? graphqlQuery().isLoading : restQuery.isLoading;
    },
    get isFetching() {
      return usesGraphql() ? graphqlQuery().isFetching : restQuery.isFetching;
    },
    get isFetchingNextPage() {
      return usesGraphql()
        ? graphqlQuery().isFetchingNextPage
        : restQuery.isFetchingNextPage;
    },
    get hasNextPage() {
      return usesGraphql()
        ? graphqlQuery().hasNextPage
        : (restQuery.hasNextPage ?? false);
    },
    get transport() {
      return usesGraphql() ? 'graphql' : 'rest';
    },
    async fetchNextPage() {
      if (usesGraphql()) await graphqlQuery().fetchNextPage();
      else await restQuery.fetchNextPage();
    },
    refetch,
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

export function invalidateUserNotifications() {
  return queryClient.invalidateQueries({
    queryKey: notificationKeys.user._def,
  });
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

type NotificationData<T> = InfiniteData<GetAllUserNotificationsResponse, T>;

function notificationQueryWantsDone(key: readonly unknown[]): boolean {
  return key.some(
    (part) =>
      !!part && typeof part === 'object' && 'done' in part && part.done === true
  );
}

function updateUserNotificationQueries(
  update: (
    data: NotificationData<UserNotificationsPageParam> | undefined,
    wantsDone: boolean
  ) => NotificationData<UserNotificationsPageParam> | undefined
) {
  for (const [key] of queryClient.getQueriesData<
    NotificationData<UserNotificationsPageParam>
  >({ queryKey: notificationKeys.user._def })) {
    queryClient.setQueryData<NotificationData<UserNotificationsPageParam>>(
      key,
      (data) => update(data, notificationQueryWantsDone(key))
    );
  }
}

type NotificationsMutationContext = {
  /**
   * Snapshot of all cached `notificationKeys.user(...)` queries so we can rollback
   * optimistic updates regardless of what limit a caller used.
   */
  previousData: Array<
    readonly [unknown, NotificationData<UserNotificationsPageParam> | undefined]
  >;
};

type UpdaterWithParams<T, P> = (
  input: Maybe<T>,
  params: P,
  wantsDone: boolean
) => Maybe<T>;

type NotificationsUpdater = UpdaterWithParams<
  NotificationData<UserNotificationsPageParam>,
  NotificationsMutationParams
>;

type NotificationsMutationCallbacks = MutationCallbacks<
  UpdateNotificationsResult,
  Error,
  NotificationsMutationParams,
  NotificationsMutationContext
>;

type NotificationsOnMutateFn = (
  variables: NotificationsMutationParams
) => Promise<NotificationsMutationContext>;

function notificationsMutationSuccessCallback(
  _: UpdateNotificationsResult,
  _params: NotificationsMutationParams
) {
  queryClient.invalidateQueries({
    queryKey: notificationKeys.user._def,
    refetchType: 'none',
  });
}

/**
 * Creates an optimistic update handler that snapshots previous data for
 * rollback. In-flight fetches are deliberately left alone: seen/done
 * overrides and unconfirmed-insert preservation make a completing stale
 * snapshot harmless, so refetches always run to completion and freshness is
 * never sacrificed for write consistency.
 */
function createNotificationsMutateFn(
  updaterFn: NotificationsUpdater
): NotificationsOnMutateFn {
  return async (params) => {
    const previousData = queryClient.getQueriesData<
      NotificationData<UserNotificationsPageParam>
    >({
      queryKey: notificationKeys.user._def,
    });

    updateUserNotificationQueries((input, wantsDone) =>
      updaterFn(input, params, wantsDone)
    );

    return { previousData };
  };
}

/** Transport-neutral notification status mutation exposed to consumers. */
export type NotificationsMutation = {
  readonly isPending: boolean;
  readonly error: Error | null;
  mutate(variables: NotificationsMutationParams): void;
  mutateAsync(
    variables: NotificationsMutationParams
  ): Promise<UpdateNotificationsResult>;
};

function createNotificationsMutation(
  operation: NotificationUpdateOperation,
  parentCallbacks?: NotificationsMutationCallbacks
) {
  return (
    callbacks?: NotificationsMutationCallbacks
  ): NotificationsMutation => {
    // Preserve the existing callback precedence: caller callbacks replace
    // parent callbacks with the same name, while cache invalidation remains
    // the outer default lifecycle.
    const lifecycle = withCallbacks<
      UpdateNotificationsResult,
      Error,
      NotificationsMutationParams,
      NotificationsMutationContext
    >(
      { onSuccess: notificationsMutationSuccessCallback },
      { ...parentCallbacks, ...callbacks }
    );

    const graphqlMutation =
      createGraphqlUpdateNotificationsMutation<NotificationsMutationContext>({
        operation,
        onMutate: async (variables) =>
          (await lifecycle.onMutate?.(
            variables,
            undefined as never
          )) as NotificationsMutationContext,
        onSuccess: async (data, variables, context) => {
          await lifecycle.onSuccess?.(
            data,
            variables,
            context as NotificationsMutationContext,
            undefined as never
          );
          // The normalized client propagates the optimistic notification row
          // into active Soup edges. Its uncached fallback cannot, so refetch
          // mounted Soup queries after the authoritative mutation succeeds.
          await refreshSoupAfterUncachedGraphqlWrite();
        },
        onError: async (error, variables, context) => {
          await lifecycle.onError?.(
            error,
            variables,
            context as NotificationsMutationContext,
            undefined as never
          );
        },
        onSettled: async (data, error, variables, context) => {
          await lifecycle.onSettled?.(
            data,
            error,
            variables,
            context as NotificationsMutationContext,
            undefined as never
          );
        },
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

function notificationsMutationErrorFn(
  _: Error,
  _params: NotificationsMutationParams,
  context: NotificationsMutationContext | undefined
) {
  if (!context) return;
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
            ? {
                ...n,
                state: nextNotificationState(n.state, 'MARK_SEEN'),
                viewed_at: n.viewed_at ?? new Date().toISOString(),
              }
            : n
        ),
      })),
    }
  );
};

/** Marks notifications as seen with optimistic update. */
export const useMarkNotificationsAsSeenMutation = createNotificationsMutation(
  'MARK_SEEN',
  {
    onMutate: createNotificationsMutateFn(mapNotificationsAsSeen),
    onError: notificationsMutationErrorFn,
  }
);

const filterOutDoneNotifications = (
  input: Maybe<NotificationData<UserNotificationsPageParam>>,
  params: NotificationsMutationParams,
  wantsDone: boolean
) => {
  return (
    input && {
      ...input,
      pages: input.pages.map((page) => ({
        ...page,
        items: wantsDone
          ? page.items.map((n) =>
              params.notificationIds.includes(n.id)
                ? { ...n, state: 'done' as const }
                : n
            )
          : page.items.filter((n) => !params.notificationIds.includes(n.id)),
      })),
    }
  );
};

const markNotificationsAsDoneMutateFn = createNotificationsMutateFn(
  filterOutDoneNotifications
);

/** Marks notifications as done (removes from list) with optimistic update. */
export const useMarkNotificationsAsDoneMutation = createNotificationsMutation(
  'MARK_DONE',
  {
    onMutate: async (params) => {
      retireUnconfirmedInserts(params.notificationIds);
      return await markNotificationsAsDoneMutateFn(params);
    },
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

export function optimisticInsertNotification(
  notification: UnifiedNotification
) {
  const item = notification as NotificationItem;

  trackUnconfirmedInsert(item);

  updateUserNotificationQueries((data, wantsDone) => {
    if ((notification.state === 'done') !== wantsDone) return data;
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
  });

  updateSoupForNotification(notification);

  // Cache is already updated via setQueriesData above. Mark as stale without
  // refetching — refetchType default would re-fetch every cached page of the
  // infinite notification query for every incoming websocket notification.
  queryClient.invalidateQueries({
    queryKey: notificationKeys.user._def,
    refetchType: 'none',
  });
}
