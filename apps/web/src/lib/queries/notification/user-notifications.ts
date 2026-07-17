import type { Maybe } from '@core/types';
import { type ResultError, throwOnErr } from '@core/util/result';
import type { UnifiedNotification } from '@notifications/types';
import {
  hasSoupEntity,
  optimisticUpdateSoupItemUpdatedAt,
  refetchSoupEntity,
  type SoupEntityTag,
} from '@queries/soup/normalized-cache';
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
import type { Result } from 'neverthrow';
import { match, P } from 'ts-pattern';
import { z } from 'zod';
import { queryClient } from '../client';
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

/**
 * Paginated query for all notifications for the current user.
 *
 * `done` filters by done status. Omitted, the server returns only active
 * (not-done) notifications; `done: true` pages through the done ones —
 * surfaces that need the complete stream (e.g. the activity timeline) run
 * one query per done state and merge.
 */
export function useUserNotificationsQuery(args?: {
  limit?: number;
  done?: boolean;
}) {
  const limit = normalizeLimit(args?.limit);

  return useInfiniteQuery(() => ({
    ...userNotificationsQueryOptions(limit, args?.done),
    select: (
      data: InfiniteData<
        GetAllUserNotificationsResponse,
        UserNotificationsPageParam
      >
    ) => data.pages.flatMap(({ items }) => items.map(stripOwnerId)),
    // Always refetch in the case of a stale browser tab
    refetchOnWindowFocus: 'always',
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

/** Plain-async wrapper around `bulkMarkNotificationAsDone`. Throws on failure. */
export async function bulkMarkNotificationsAsDone(
  notificationIds: string[]
): Promise<void> {
  await throwOnErr(
    async () =>
      await notificationServiceClient.bulkMarkNotificationAsDone({
        notificationIds,
      })
  );
}

/** Plain-async wrapper around `bulkMarkNotificationAsUndone`. Throws on failure. */
export async function bulkMarkNotificationsAsUndone(
  notificationIds: string[]
): Promise<void> {
  await throwOnErr(
    async () =>
      await notificationServiceClient.bulkMarkNotificationAsUndone({
        notificationIds,
      })
  );
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

type NotificationsMutationCallbacks<T> = MutationCallbacks<
  T,
  Error,
  NotificationsMutationParams,
  NotificationsMutationContext
>;

type NotificationsMutationFn<T> = MutationFunction<
  Result<T, ResultError<string>[]>,
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

const markNotificationsAsDoneMutateFn = createNotificationsMutateFn(
  filterOutDoneNotifications
);

/** Marks notifications as done (removes from list) with optimistic update. */
export const useMarkNotificationsAsDoneMutation = createNotificationsMutation(
  async (params: NotificationsMutationParams) =>
    await notificationServiceClient.bulkMarkNotificationAsDone({
      notificationIds: params.notificationIds,
    }),
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
    .with(
      P.union(
        'user',
        'team',
        'call',
        'channel_message',
        'static_file',
        'crm_company',
        'crm_contact'
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
  }

  // Cache is already updated via setQueriesData above. Mark as stale without
  // refetching — refetchType default would re-fetch every cached page of the
  // infinite notification query for every incoming websocket notification.
  queryClient.invalidateQueries({
    queryKey: notificationKeys.user._def,
    refetchType: 'none',
  });
}
