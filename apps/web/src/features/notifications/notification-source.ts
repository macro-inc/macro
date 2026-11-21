import { ENABLE_DOCUMENT_MENTION_NOTIFICATIONS } from '@core/constant/featureFlags';
import type { Entity } from '@core/types';
import { fireAndForget } from '@core/util/fireAndForget';
import { muteItemForRef } from '@entity/utils/notification';
import { Telemetry } from '@macro-inc/observability';
import {
  currentQueryAccount,
  isCurrentQueryAccount,
  type QueryAccount,
  queryAccountSessionPending,
} from '@queries/auth/account-scope';
import {
  ActiveNotificationIdsTimeoutError,
  fetchActiveNotificationIds,
} from '@queries/notification/graphql/active-notification-ids';
import {
  revalidateNotifiedGraphqlSoupLists,
  updateSoupForNotification,
} from '@queries/notification/notification-soup';
import {
  useMuteItemMutation,
  useUnmuteItemMutation,
} from '@queries/notification/unsubscribes';
import {
  type UserNotificationsQuery,
  useMarkNotificationsAsDoneMutation,
  useMarkNotificationsAsSeenMutation,
  useUserNotificationsQuery,
} from '@queries/notification/user-notifications';
import type { UserUnsubscribe } from '@service-notification/generated/schemas';
import {
  mapGraphqlNotification,
  subscribeGraphqlSoupReconnected,
} from '@service-storage/graphql-soup';
import { subscribeToGraphqlNotificationPatches } from '@service-storage/graphql-soup-websocket';
import { createLazyMemo } from '@solid-primitives/memo';
import type { UseQueryResult } from '@tanstack/solid-query';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { nextNotificationState } from './notification-state';
import { createMutedEntitiesQuery } from './queries/muted-entities-query';
import {
  type CompositeEntity,
  compositeEntity,
  notificationEntity,
  type UnifiedNotification,
} from './types';

export const CHANNEL_EVENT_TYPES = [
  'channel_mention',
  'channel_message_send',
  'channel_message_reaction',
  'channel_message_reply',
  'document_mention',
] as const;

type NotificationsByEntity = Record<CompositeEntity, UnifiedNotification[]>;

type UnsubscribeFn = () => void;
type SubscribeFn = (newNotification: UnifiedNotification) => void;

export type NotificationSource = {
  readonly notificationsByEntity: Accessor<NotificationsByEntity>;
  readonly notifications: Accessor<UnifiedNotification[]>;
  readonly mutedEntities: Accessor<UserUnsubscribe[]>;
  readonly isLoading: Accessor<boolean>;
  /** Whether the session may read notifications at all; never starts the feed. */
  readonly isEnabled: Accessor<boolean>;

  readonly _notificationsQuery: UserNotificationsQuery;

  readonly _mutedEntitiesQuery: UseQueryResult<UserUnsubscribe[], Error>;

  /** Mark a single notification as done */
  markAsDone: (notification: UnifiedNotification) => Promise<void>;

  /** Mark a single notification as read */
  markAsRead: (notification: UnifiedNotification) => Promise<void>;

  /** Bulk mark notifications as done */
  bulkMarkAsDone: (notifications: UnifiedNotification[]) => Promise<void>;

  /** Bulk mark notifications as read */
  bulkMarkAsRead: (notifications: UnifiedNotification[]) => Promise<void>;

  /** unsubscribe from entity notifications */
  muteEntity: (entity: Entity) => Promise<void>;

  /** subscribe to entity notifications */
  unmuteEntity: (entity: Entity) => Promise<void>;

  /** Apply local seen/done intent to a GraphQL edge without replacing its data. */
  withLocalOverrides?: (
    notification: UnifiedNotification
  ) => UnifiedNotification;

  /** Apply local intent to an unread witness without fetching full metadata. */
  withLocalState?: (
    notification: Pick<UnifiedNotification, 'id' | 'state'>
  ) => UnifiedNotification['state'];

  /** subscribe to new notifications */
  subscribe: (subscribe: SubscribeFn) => UnsubscribeFn;
};

const QUERY_LIMIT = 500;

const DOCUMENT_MENTION = 'document_mention';
// The server's maximum; mentions beyond it wait for the next pass.
const DOCUMENT_MENTION_CLEANUP_LIMIT = 500;

type DocumentMentionCleanupError =
  | 'read_timeout'
  | 'read_failed'
  | 'mark_failed';

function documentMentionCleanupError(
  stage: 'read' | 'mark',
  error: unknown
): DocumentMentionCleanupError {
  if (stage === 'mark') return 'mark_failed';
  if (error instanceof ActiveNotificationIdsTimeoutError) return 'read_timeout';
  return 'read_failed';
}

// Persistent overrides for the `done` flag that survive cache writes.
// In-flight infinite-query page fetches can land after an optimistic cache
// flip and overwrite it with stale server data; this map keeps the UI
// consistent regardless of what the cache says. Overrides are never pruned from
// the feed: an id leaving it says nothing about still-mounted Soup edges.
type DoneOverride = { done: boolean; reopened: boolean };
const [doneOverrides, setDoneOverrides] = createRoot(() =>
  createSignal<ReadonlyMap<string, DoneOverride>>(new Map())
);

export function setDoneOverride(
  ids: readonly string[],
  done: boolean | undefined
) {
  if (ids.length === 0)
    return Object.assign(() => undefined, { release: () => {} });
  const previous = untrack(
    () => new Map(ids.map((id) => [id, doneOverrides().get(id)]))
  );
  const applied = new Map<string, DoneOverride | undefined>();
  setDoneOverrides((prev) => {
    const next = new Map(prev);
    for (const id of ids) {
      if (done === undefined) next.delete(id);
      else
        next.set(id, {
          done,
          reopened:
            !done &&
            (prev.get(id)?.done === true || prev.get(id)?.reopened === true),
        });
      applied.set(id, next.get(id));
    }
    return next;
  });
  // A failed older mutation must not undo a newer local action.
  const finish = (restorePrevious: boolean) =>
    setDoneOverrides((current) => {
      const next = new Map(current);
      for (const id of ids) {
        if (current.get(id) !== applied.get(id)) continue;
        const before = restorePrevious ? previous.get(id) : undefined;
        if (before === undefined) next.delete(id);
        else next.set(id, before);
      }
      return next;
    });
  return Object.assign(() => finish(true), {
    // A partially committed reversal needs authoritative state, not a guessed
    // all-or-nothing rollback. Only release this operation's own contribution.
    release: () => finish(false),
  });
}

// Client-asserted seen state, the `doneOverrides` twin for `viewed_at`. Seen
// is monotone (there is no unsee API), so once a mark is initiated no fetch
// snapshot may present the notification as unread: a full refetch reads its
// pages over several seconds and a page read before the mark's POST commits
// resurrects pre-write state when it lands. Entries are removed on mutation
// failure (that rollback is deliberate). They are never pruned from the feed:
// Soup edges can still hold older snapshots independently of it.
type SeenOverride = { viewedAt: string; token: symbol };
const [seenOverrides, setSeenOverrides] = createRoot(() =>
  createStore<Record<string, SeenOverride | undefined>>({})
);

function setSeenOverride(ids: readonly string[], viewedAt: string | undefined) {
  if (ids.length === 0) return () => undefined;
  const token = Symbol();
  const previous = untrack(
    () =>
      new Map(
        ids.map((id) => {
          const entry = seenOverrides[id];
          return [id, entry ? { ...entry } : undefined] as const;
        })
      )
  );
  batch(() => {
    for (const id of ids)
      setSeenOverrides(
        id,
        viewedAt === undefined ? undefined : { viewedAt, token }
      );
  });
  return () =>
    batch(() => {
      for (const id of ids) {
        if (seenOverrides[id]?.token === token)
          setSeenOverrides(id, previous.get(id));
      }
    });
}

/** Applies local intent to a bounded state-only witness without loading the feed. */
function notificationStateWithLocalOverrides(
  notification: Pick<UnifiedNotification, 'id' | 'state'>
): UnifiedNotification['state'] {
  const override = doneOverrides().get(notification.id);
  const state = override?.done
    ? 'done'
    : override?.reopened
      ? 'seen'
      : override
        ? nextNotificationState(notification.state, 'MARK_UNDONE')
        : notification.state;
  return state === 'unseen' && seenOverrides[notification.id] ? 'seen' : state;
}

function withNotificationOverrides(
  notification: UnifiedNotification
): UnifiedNotification {
  const doneOverride = doneOverrides().get(notification.id);
  if (notification.state !== 'unseen' && doneOverride === undefined) {
    return notification;
  }
  return {
    ...notification,
    get state() {
      return notificationStateWithLocalOverrides(notification);
    },
    // Only the affected id's seen state is a dependency of this row.
    get viewed_at() {
      if (notification.viewed_at) return notification.viewed_at;
      return seenOverrides[notification.id]?.viewedAt ?? notification.viewed_at;
    },
  };
}

export function createNotificationSource(
  onNotification?: (notification: UnifiedNotification) => void,
  enabled: Accessor<boolean> = () => true
): NotificationSource {
  const subscriptions: Set<SubscribeFn> = new Set();

  const notificationsQuery = useUserNotificationsQuery(
    () => ({ limit: QUERY_LIMIT }),
    () => ({ enabled: enabled() })
  );
  const mutedEntitiesQuery = createMutedEntitiesQuery(
    { limit: QUERY_LIMIT },
    enabled
  );
  // Read the current query rather than retaining a second copy across sessions.
  const mutedEntities = createMemo(() => {
    if (!enabled() || mutedEntitiesQuery.isPending) return [];
    return mutedEntitiesQuery.data ?? [];
  });
  const muteItem = useMuteItemMutation();
  const unmuteItem = useUnmuteItemMutation();

  const markNotificationsAsSeenMutation = useMarkNotificationsAsSeenMutation();
  const markNotificationsAsDoneMutation = useMarkNotificationsAsDoneMutation();

  // Gate on data presence, not isSuccess: a failed or cancelled background
  // refetch flips status to error while the cached pages remain, and blanking
  // every unread surface over a transient refetch is worse than showing the
  // cached state.
  // A shell that only needs mute state, local overrides, or realtime callbacks
  // must not instantiate the full GraphQL notification feed at startup.
  const notifications = createLazyMemo(() => {
    if (!enabled() || notificationsQuery.isLoading) return [];
    const raw = notificationsQuery.data;
    if (!raw) return [];
    return raw.map(withNotificationOverrides);
  });

  const notificationsByEntity = createLazyMemo(() => {
    const data = notifications();
    const grouped: NotificationsByEntity = {};

    for (const notification of data) {
      const composite = compositeEntity(notificationEntity(notification));
      grouped[composite] ??= [];
      grouped[composite].push(notification);
    }

    return grouped;
  });

  const isLoading = () => {
    return (
      enabled() &&
      (notificationsQuery.isLoading || mutedEntitiesQuery.isLoading)
    );
  };

  // TODO(dev-rb/notifications): Verify whether document-mention suppression is
  // still required, and remove this source-based cleanup when it is not.
  if (!ENABLE_DOCUMENT_MENTION_NOTIFICATIONS) {
    const discardDocumentMentions = async (notificationIds: string[]) => {
      try {
        await markNotificationsAsDoneMutation.mutateAsync({ notificationIds });
      } catch (error) {
        console.error(
          'Failed to discard document mention notifications',
          error
        );
      }
    };
    // This never reads the feed. Each account session reads the ids of every
    // active mention once, and again after the GraphQL websocket reconnects,
    // which also reaches mentions outside the feed's window; mentions
    // delivered while connected are discarded as they arrive. A read that
    // lands for another account or after sign-out is dropped. A failed read or
    // mark is logged once and skips the cleanup for the rest of that account
    // session; nothing retries it.
    let skippedAccount: QueryAccount | undefined;
    const discardActiveDocumentMentions = (account: QueryAccount) =>
      Telemetry.span('notification.document_mention_cleanup', async (span) => {
        let stage: 'read' | 'mark' = 'read';
        try {
          const ids = await fetchActiveNotificationIds(
            [DOCUMENT_MENTION],
            DOCUMENT_MENTION_CLEANUP_LIMIT
          );
          span.setAttr('notification.id_count', ids.length);
          const current = isCurrentQueryAccount(account) && enabled();
          if (ids.length === 0 || !current) return;
          stage = 'mark';
          await markNotificationsAsDoneMutation.mutateAsync({
            notificationIds: ids,
          });
        } catch (error) {
          const errorType = documentMentionCleanupError(stage, error);
          span.setAttr('error.type', errorType);
          span.error(errorType);
          skippedAccount = account;
          console.warn(
            'Skipped document mention cleanup for this session',
            error
          );
        }
      });
    const startDocumentMentionCleanup = () => {
      const account = currentQueryAccount();
      if (!account) return;
      const skipped =
        skippedAccount?.userId === account.userId &&
        skippedAccount.session === account.session;
      if (skipped) return;
      fireAndForget(discardActiveDocumentMentions(account), 'notifications');
    };
    createEffect(() => {
      // The account session also changes when a login replaces the session
      // in place, without a sign-out: wait for the new identity, then run.
      if (!enabled() || queryAccountSessionPending()) return;
      untrack(startDocumentMentionCleanup);
    });
    onCleanup(
      subscribeGraphqlSoupReconnected(() => {
        if (enabled()) startDocumentMentionCleanup();
      })
    );
    subscriptions.add((notification) => {
      if (notification.notification_event_type !== DOCUMENT_MENTION) return;
      fireAndForget(
        discardDocumentMentions([notification.id]),
        'notifications'
      );
    });
  }

  const dispatchIncomingNotification = (
    notification: UnifiedNotification
  ): void => {
    onNotification?.(notification);
    subscriptions.forEach((subscribe) => subscribe(notification));
  };

  let graphqlRefetchScheduled = false;
  let graphqlRefetchInFlight = false;
  let graphqlRefetchPending = false;
  let graphqlSubscriptionDisposed = false;

  const runGraphqlNotificationRefetch = async (): Promise<void> => {
    if (!enabled() || graphqlSubscriptionDisposed || graphqlRefetchInFlight)
      return;
    graphqlRefetchInFlight = true;
    try {
      do {
        graphqlRefetchPending = false;
        try {
          await notificationsQuery.refetch();
        } catch (error) {
          console.warn(
            'Failed to refresh notifications after GraphQL patch',
            error
          );
        }
      } while (graphqlRefetchPending && !graphqlSubscriptionDisposed);
    } finally {
      graphqlRefetchInFlight = false;
    }
  };

  const scheduleGraphqlNotificationRefetch = (): void => {
    // Still dispatch new-notification callbacks below. The first actual feed
    // reader will fetch current data; a patch must not wake an unused feed.
    if (!enabled() || !notificationsQuery.isStarted) return;
    graphqlRefetchPending = true;
    if (graphqlRefetchScheduled || graphqlRefetchInFlight) return;
    graphqlRefetchScheduled = true;
    queueMicrotask(() => {
      graphqlRefetchScheduled = false;
      fireAndForget(runGraphqlNotificationRefetch(), 'notifications');
    });
  };

  const unsubscribeFromGraphql = subscribeToGraphqlNotificationPatches(
    (patch) => {
      if (!enabled()) return;
      scheduleGraphqlNotificationRefetch();
      if (patch.__typename !== 'GraphqlNewNotification') {
        // Main's REST Home rows render this source, which the refetch above
        // brings current. Rows of GraphQL notified lists render their own
        // notifications as last read, and nothing patches an entity the
        // refetch no longer returns (notifications deleted, access lost):
        // read those lists again too.
        revalidateNotifiedGraphqlSoupLists();
        return;
      }
      const notification = mapGraphqlNotification(patch.notification);
      updateSoupForNotification(notification);
      dispatchIncomingNotification(notification);
    }
  );
  onCleanup(() => {
    graphqlSubscriptionDisposed = true;
    unsubscribeFromGraphql();
  });

  // Skip empty batches: entity-level read markers fire on mount regardless
  // of whether the entity has notifications, and an empty batch would still
  // POST a no-op mutation.
  const bulkMarkAsDone = async (notifications: UnifiedNotification[]) => {
    if (!enabled() || notifications.length === 0) return;
    const ids = notifications.map((n) => n.id);
    const rollback = setDoneOverride(ids, true);
    try {
      await markNotificationsAsDoneMutation.mutateAsync({
        notificationIds: ids,
      });
    } catch (err) {
      rollback();
      throw err;
    }
  };

  const bulkMarkAsRead = async (notifications: UnifiedNotification[]) => {
    if (!enabled() || notifications.length === 0) return;
    const ids = notifications.map((n) => n.id);
    const rollback = setSeenOverride(ids, new Date().toISOString());
    try {
      await markNotificationsAsSeenMutation.mutateAsync({
        notificationIds: ids,
      });
    } catch (err) {
      rollback();
      throw err;
    }
  };

  const markAsDone = async (notification: UnifiedNotification) => {
    await bulkMarkAsDone([notification]);
  };

  const markAsRead = async (notification: UnifiedNotification) => {
    await bulkMarkAsRead([notification]);
  };

  // Canonicalize the type where we know how to; otherwise pass it through so
  // legacy callers keep working unchanged.
  const toMuteItem = (entity: Entity): UserUnsubscribe =>
    muteItemForRef(entity) ?? { item_id: entity.id, item_type: entity.type };

  const muteEntity = async (entity: Entity) => {
    if (!enabled()) return;
    await muteItem.mutateAsync(toMuteItem(entity));
  };

  const unmuteEntity = async (entity: Entity) => {
    if (!enabled()) return;
    await unmuteItem.mutateAsync(toMuteItem(entity));
  };

  const subscribe = (subscribeFn: SubscribeFn) => {
    subscriptions.add(subscribeFn);
    return () => {
      subscriptions.delete(subscribeFn);
    };
  };

  return {
    notificationsByEntity,
    notifications,
    mutedEntities,
    isLoading,
    isEnabled: enabled,
    _notificationsQuery: notificationsQuery,
    _mutedEntitiesQuery: mutedEntitiesQuery,
    markAsDone,
    markAsRead,
    bulkMarkAsRead,
    bulkMarkAsDone,
    muteEntity,
    unmuteEntity,
    subscribe,
    withLocalOverrides: withNotificationOverrides,
    withLocalState: notificationStateWithLocalOverrides,
  };
}
