import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import type { Maybe } from '@core/types';
import { throwOnErr } from '@core/util/result';
import { channelThreadRootId } from '@notifications/channel-thread-root';
import type { UnifiedNotification } from '@notifications/types';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import {
  bumpSoupEntityNotifiedAt,
  hasSoupEntity,
  optimisticUpdateSoupItemUpdatedAt,
  refetchSoupEntity,
  restoreSoupEntityToDoneFilteredQueries,
  type SoupEntityTag,
} from '@queries/soup/normalized-cache';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { notificationServiceClient } from '@service-notification/client';
import type { ApiUserNotification } from '@service-notification/generated/schemas/apiUserNotification';
import type { GetAllUserNotificationsResponse } from '@service-notification/generated/schemas/getAllUserNotificationsResponse';
import type { NotificationUpdateOperation } from '@service-storage/graphql/generated/graphql';
import { updateNotifications } from '@service-storage/graphql-notifications';
import { graphqlCacheEnabled } from '@service-storage/graphql-soup';
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { match, P } from 'ts-pattern';
import { z } from 'zod';
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
        .filter((item) => !presentIds.has(item.id));
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
            done,
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
      select: (
        data: InfiniteData<
          GetAllUserNotificationsResponse,
          UserNotificationsPageParam
        >
      ) => data.pages.flatMap(({ items }) => items.map(stripOwnerId)),
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

  const usesGraphql = () =>
    isFeatureEnabled(enableGraphqlSoup) && args().done !== true;

  const graphqlQuery = createGraphqlNotificationsQuery(args, () => ({
    enabled: queryEnabled() && usesGraphql(),
  }));

  const restQuery = useRestUserNotificationsQuery(args, () => ({
    enabled: queryEnabled() && !usesGraphql(),
  }));

  const refetch = async () => {
    if (usesGraphql()) {
      await graphqlQuery.refetch({
        requestPolicy: 'network-only',
        throwOnError: true,
      });
    } else {
      await restQuery.refetch();
    }
  };

  return {
    get data() {
      return usesGraphql() ? graphqlQuery.data : restQuery.data;
    },
    get error() {
      return usesGraphql()
        ? graphqlQuery.error
        : ((restQuery.error as Error | null) ?? null);
    },
    get isLoading() {
      return usesGraphql() ? graphqlQuery.isLoading : restQuery.isLoading;
    },
    get isFetching() {
      return usesGraphql() ? graphqlQuery.isFetching : restQuery.isFetching;
    },
    get isFetchingNextPage() {
      return usesGraphql()
        ? graphqlQuery.isFetchingNextPage
        : restQuery.isFetchingNextPage;
    },
    get hasNextPage() {
      return usesGraphql()
        ? graphqlQuery.hasNextPage
        : (restQuery.hasNextPage ?? false);
    },
    get transport() {
      return usesGraphql() ? 'graphql' : 'rest';
    },
    async fetchNextPage() {
      if (usesGraphql()) await graphqlQuery.fetchNextPage();
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
function _useEntitiesNotificationsQuery(args: {
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

async function refreshSoupAfterUncachedGraphqlWrite(): Promise<void> {
  if (isFeatureEnabled(enableGraphqlSoup) && !graphqlCacheEnabled()) {
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
          done: true,
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

async function updateRestNotifications(
  params: NotificationsMutationParams,
  operation: NotificationUpdateOperation
): Promise<UpdateNotificationsResult> {
  const request = { notificationIds: params.notificationIds };
  switch (operation) {
    case 'MARK_SEEN':
      await throwOnErr(
        async () =>
          await notificationServiceClient.bulkMarkNotificationAsSeen(request)
      );
      break;
    case 'MARK_DONE':
      await throwOnErr(
        async () =>
          await notificationServiceClient.bulkMarkNotificationAsDone(request)
      );
      break;
    case 'MARK_UNDONE':
      await throwOnErr(
        async () =>
          await notificationServiceClient.bulkMarkNotificationAsUndone(request)
      );
      break;
  }
  return [];
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

    const restMutation = useMutation(() => ({
      mutationFn: (variables: NotificationsMutationParams) =>
        updateRestNotifications(variables, operation),
      ...lifecycle,
    }));
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
        return isFeatureEnabled(enableGraphqlSoup)
          ? graphqlMutation.isPending
          : restMutation.isPending;
      },
      get error() {
        return isFeatureEnabled(enableGraphqlSoup)
          ? graphqlMutation.error
          : (restMutation.error ?? null);
      },
      mutate(variables) {
        if (isFeatureEnabled(enableGraphqlSoup)) {
          graphqlMutation.mutate(variables);
        } else {
          restMutation.mutate(variables);
        }
      },
      async mutateAsync(variables) {
        if (!isFeatureEnabled(enableGraphqlSoup)) {
          return await restMutation.mutateAsync(variables);
        }

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
            ? { ...n, viewed_at: new Date().toISOString() }
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

export type NotificationStatusPatch = {
  id: string;
  done: boolean;
  viewed_at: string | null;
  updated_at: string;
};

export type NotificationStatusPatchDelete =
  | { t: 'Patch'; c: NotificationStatusPatch }
  | { t: 'Delete'; c: { id: string } };

export type NotificationStatusUpdate = {
  type: 'notification_status_updated';
  updates: NotificationStatusPatchDelete[];
};

const jsonStringSchema = z.string().transform((value, ctx) => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid JSON' });
    return z.NEVER;
  }
});

export const notificationStatusUpdateSchema = z.object({
  type: z.literal('notification_status_updated'),
  updates: z.array(
    z.discriminatedUnion('t', [
      z.object({
        t: z.literal('Patch'),
        c: z.object({
          id: z.string(),
          done: z.boolean(),
          viewed_at: z.string().nullable(),
          updated_at: z.string(),
        }),
      }),
      z.object({
        t: z.literal('Delete'),
        c: z.object({
          id: z.string(),
        }),
      }),
    ])
  ),
}) satisfies z.ZodType<NotificationStatusUpdate>;

export const notificationStatusUpdatePayloadSchema = z.union([
  notificationStatusUpdateSchema,
  jsonStringSchema.pipe(notificationStatusUpdateSchema),
]);

function applyNotificationStatusPatch(
  notification: NotificationItem,
  patch: NotificationStatusPatch
): NotificationItem {
  return {
    ...notification,
    ...(patch.done !== undefined ? { done: patch.done } : {}),
    ...(patch.viewed_at !== undefined ? { viewed_at: patch.viewed_at } : {}),
    ...(patch.updated_at !== undefined ? { updated_at: patch.updated_at } : {}),
  };
}

export function applyNotificationStatusUpdate(
  update: NotificationStatusUpdate
) {
  const patches = update.updates
    .filter((item) => item.t === 'Patch')
    .map((item) => item.c);
  const patchById = new Map(patches.map((patch) => [patch.id, patch]));
  const deleteIds = new Set(
    update.updates
      .filter((item) => item.t === 'Delete')
      .map((item) => item.c.id)
  );
  const doneIds = new Set(
    [...patchById.values()]
      .filter((patch) => patch.done === true)
      .map((patch) => patch.id)
  );
  const removeIds = new Set([...deleteIds, ...doneIds]);

  retireUnconfirmedInserts(removeIds);

  queryClient.setQueriesData<NotificationData<UserNotificationsPageParam>>(
    { queryKey: notificationKeys.user._def },
    (data) => {
      if (!data) return data;

      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items
            .filter((notification) => !removeIds.has(notification.id))
            .map((notification) => {
              const patch = patchById.get(notification.id);
              return patch
                ? applyNotificationStatusPatch(notification, patch)
                : notification;
            }),
        })),
      };
    }
  );

  queryClient.invalidateQueries({
    queryKey: notificationKeys.user._def,
    refetchType: 'none',
  });
}

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
    .with('foreign_entity', () => 'foreignEntity' as const)
    .with('reminder', () => 'reminder' as const)
    .with('calendar_event', () => 'calendarEvent' as const)
    .with(
      P.union(
        'user',
        'team',
        'call',
        'channel_message',
        'static_file',
        'crm_company',
        'crm_contact',
        'skill',
        'agent_session'
      ),
      () => null
    )
    .exhaustive();
}

/**
 * Snapshot the cached notification objects for the given ids. The returned
 * items can later be put back via `restoreUserNotifications`. Optimistic
 * mark-done flows rely on this so undo can resurrect notifications that get
 * dropped from the cache once the server confirms the done — whether by the
 * `notification_status_updated` event or a stale refetch. A plain `done`
 * override can't overlay a notification that is no longer in the cache.
 */
export function snapshotUserNotifications(ids: string[]): NotificationItem[] {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const found = new Map<string, NotificationItem>();
  for (const [, data] of queryClient.getQueriesData<
    NotificationData<UserNotificationsPageParam>
  >({ queryKey: notificationKeys.user._def })) {
    if (!data) continue;
    for (const page of data.pages) {
      for (const notification of page.items) {
        if (idSet.has(notification.id) && !found.has(notification.id)) {
          found.set(notification.id, notification);
        }
      }
    }
  }
  return [...found.values()];
}

/**
 * Re-insert snapshotted notifications that are no longer in the cache (e.g.
 * dropped after a mark-done was confirmed), marking each not-done so it
 * re-enters not-done filtered views. Notifications still present are left
 * untouched.
 */
export function restoreUserNotifications(notifications: NotificationItem[]) {
  if (notifications.length === 0) return;
  queryClient.setQueriesData<NotificationData<UserNotificationsPageParam>>(
    { queryKey: notificationKeys.user._def },
    (data) => {
      if (!data) return data;
      const present = new Set(
        data.pages.flatMap((page) => page.items.map((n) => n.id))
      );
      const missing = notifications
        .filter((n) => !present.has(n.id))
        .map((n) => ({ ...n, done: false }));
      if (missing.length === 0) return data;
      return {
        ...data,
        pages: data.pages.map((page, index) =>
          index === 0 ? { ...page, items: [...missing, ...page.items] } : page
        ),
      };
    }
  );
  queryClient.invalidateQueries({
    queryKey: notificationKeys.user._def,
    refetchType: 'none',
  });
}

/** The firing a reminder notification was written for, when it records one. */
function reminderFiringOf(notification: NotificationItem): number | undefined {
  const metadata = notification.notification_metadata;
  if (metadata?.tag !== 'reminder') return undefined;
  const { scheduledFor } = metadata.content;
  if (!scheduledFor) return undefined;
  const at = new Date(scheduledFor).getTime();
  return Number.isNaN(at) ? undefined : at;
}

/**
 * Whether `existing` is an earlier firing of the reminder `arriving` is for.
 *
 * A recurring reminder produces one notification per firing, all pointing at
 * the same reminder. The two surfaces deliberately differ in what they do with
 * that, and it is worth stating plainly because the code pulls both ways:
 *
 * - **Push alerts are per firing.** The APNS collapse key includes the firing,
 *   so today's lock-screen alert does not replace yesterday's unread one.
 * - **The notification list keeps one row per reminder.** A month away should
 *   not return thirty identical "standup" rows to work through; the outstanding
 *   firing is the one that matters.
 *
 * The dispatcher enforces the second server-side by retracting earlier firings
 * as the next is delivered. That delete has no realtime event, and the arriving
 * notification is merged into the cache without a refetch, so nothing here
 * would otherwise notice — this is what keeps the two sides agreeing.
 *
 * Matched on the firing rather than on the reminder alone, so a redelivery of
 * the *same* firing arriving under a fresh notification id replaces its twin
 * instead of being treated as a new occurrence, and a row from a firing later
 * than the arriving one is left alone.
 */
function isSupersededReminder(
  existing: NotificationItem,
  arriving: NotificationItem
): boolean {
  if (arriving.entity_type !== 'reminder') return false;
  if (existing.entity_type !== 'reminder') return false;
  if (existing.entity_id !== arriving.entity_id) return false;
  // Same notification, not a superseded one — that case is handled as a
  // duplicate insert.
  if (existing.id === arriving.id) return false;

  const existingFiring = reminderFiringOf(existing);
  const arrivingFiring = reminderFiringOf(arriving);
  // Either side predates the firing being recorded, so there is nothing to
  // compare: fall back to one-row-per-reminder, which is the policy anyway.
  if (existingFiring === undefined || arrivingFiring === undefined) return true;

  return existingFiring <= arrivingFiring;
}

export function optimisticInsertNotification(
  notification: UnifiedNotification
) {
  const item = notification as NotificationItem;
  const soupTag = notificationEntityTypeToSoupTag(notification.entity_type);

  trackUnconfirmedInsert(item);

  queryClient.setQueriesData<NotificationData<UserNotificationsPageParam>>(
    { queryKey: notificationKeys.user._def },
    (data) => {
      if (!data) return data;

      const exists = data.pages.some((page) =>
        page.items.some((n) => n.id === item.id)
      );
      if (exists) return data;

      // Clear the firing this one replaces before inserting, so a daily reminder
      // shows one row rather than one per day since the user last looked.
      //
      // Retired from `unconfirmedInserts` as well as dropped from the pages. A
      // superseded firing that arrived over the websocket is still tracked
      // there, and `reapplyUnconfirmedInserts` re-prepends anything it finds
      // missing from the pages — so removing it here alone would put it back on
      // the next query success and leave it sitting beside its replacement.
      const superseded = data.pages.flatMap((page) =>
        page.items.filter((n) => isSupersededReminder(n, item)).map((n) => n.id)
      );
      if (superseded.length > 0) {
        retireUnconfirmedInserts(superseded);
        const ids = new Set(superseded);
        data = {
          ...data,
          pages: data.pages.map((page) =>
            page.items.some((n) => ids.has(n.id))
              ? { ...page, items: page.items.filter((n) => !ids.has(n.id)) }
              : page
          ),
        };
      }

      return {
        ...data,
        pages: data.pages.map((page, index) =>
          index === 0 ? { ...page, items: [item, ...page.items] } : page
        ),
      };
    }
  );

  if (soupTag) {
    if (hasSoupEntity(notification.entity_id)) {
      if (notification.created_at) {
        optimisticUpdateSoupItemUpdatedAt(
          notification.entity_id,
          soupTag,
          notification.created_at
        );
      }
    } else {
      refetchSoupEntity(notification.entity_id, soupTag);
    }

    // The inbox's notified_at order moves the notified row up right away
    // rather than on the next refetch of the page. A mention or thread reply
    // belongs to its channel-thread row — the row the soup feed keys it on —
    // so that is the row stamped (and fetched in, when it is not cached yet),
    // not the channel's.
    const threadRootId = channelThreadRootId(notification);
    if (notification.created_at) {
      bumpSoupEntityNotifiedAt(
        threadRootId ?? notification.entity_id,
        notification.created_at
      );
    }
    if (threadRootId && !hasSoupEntity(threadRootId)) {
      refetchSoupEntity(threadRootId, 'channelThread');
    }

    // A cached row may be absent from the done-filtered feeds — dropped when
    // it was marked done, or the feed was fetched while it had nothing
    // outstanding. The field merges above only patch rows already present,
    // so put the row back where it is missing; otherwise this notification
    // stays invisible in the inbox until the next refetch. No-op for rows
    // the refetch paths above insert.
    restoreSoupEntityToDoneFilteredQueries(
      threadRootId ?? notification.entity_id
    );
  }

  // Cache is already updated via setQueriesData above. Mark as stale without
  // refetching — refetchType default would re-fetch every cached page of the
  // infinite notification query for every incoming websocket notification.
  queryClient.invalidateQueries({
    queryKey: notificationKeys.user._def,
    refetchType: 'none',
  });
}
