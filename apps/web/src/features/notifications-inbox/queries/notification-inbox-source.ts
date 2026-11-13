import { createUrqlInfiniteQuery } from '@app/lib/urql-solid/create-urql-infinite-query';
import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/host/types';
import type { UnifiedNotification } from '@notifications/types';
import { createLiveAttentionFeed } from '@queries/attention-feed/live-attention-feed';
import {
  NotificationInboxDocument,
  type NotificationInboxQuery,
  type NotificationInboxQueryVariables,
  type NotificationInboxScopeInput,
  NotificationInboxUpdatesDocument,
} from '@service-storage/graphql/generated/graphql';
import { type Client, stringifyDocument } from '@urql/core';
import {
  type Accessor,
  createComputed,
  createMemo,
  createSignal,
  on,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type {
  InboxFeedSource,
  InboxScope,
  NotificationInboxRow,
} from '../context/notifications-inbox-context';
import { clearIncludes, type InboxClear } from '../core/inbox-filters';
import {
  compareInboxRows,
  markRows,
  type RowMarks,
  settleRowMarks,
  unmarkRows,
  withoutDoneNotifications,
  withoutDoneRows,
  withSeenRows,
} from '../core/inbox-row';
import { encodeInboxScope, toInboxGroup } from './decode';
import {
  type NotificationInboxGroup,
  orderInboxRows,
} from './notification-inbox-groups';
import {
  clearInboxBatch,
  markInboxNotificationDone,
  markInboxRowsDone,
  markInboxRowsSeen,
  undoInboxRowsDone,
} from './notification-inbox-mutations';
import { notificationInboxShape } from './notification-inbox-shape';

/** Entries fetched per inbox page. */
export const INBOX_PAGE_LIMIT = 50;
/** Most batches one clear sends: 20,000 groups at the server's default. */
const MAX_CLEAR_BATCHES = 200;

const inboxCachedQuery = {
  query: stringifyDocument(NotificationInboxDocument),
  operationName: 'NotificationInbox',
};

const isGroup = (
  group: NotificationInboxGroup | null
): group is NotificationInboxGroup => group !== null;

/** The variables of the inbox page that starts at `cursor`. */
export const inboxPageVariables = (
  scope: NotificationInboxScopeInput,
  cursor: string | null
): NotificationInboxQueryVariables => ({
  input: { scope, limit: INBOX_PAGE_LIMIT, cursor },
});

export type NotificationInboxSourceOptions = {
  /** App presentation gates, rechecked reactively; absent preserves every row. */
  includeRow?: (row: NotificationInboxRow) => boolean;
  client: Accessor<Client>;
  /** The normalized cache holding the inbox's pages, when it is available. */
  cacheHost: Accessor<Pick<CacheHost, 'readQuery' | 'writeQuery'> | undefined>;
  scope: Accessor<InboxScope>;
  enabled: Accessor<boolean>;
  /** Subscribes to transport reconnects, after which changes may be missed. */
  onReconnected?: (listener: () => void) => () => void;
  /**
   * Shows the done to other readers of these notifications at once, until
   * the server's change reaches them; returns the reversal.
   */
  overrideNotificationsDone?: (ids: readonly string[]) => () => void;
  /** Reconciles other notification readers after a done, undo or seen. */
  revalidateNotifications?: (client: Client) => Promise<void>;
};

/**
 * The inbox read from the server's notification inbox: its rows, kept
 * current by its live stream through the shared attention feed client. Done
 * and seen address single rows and show at once, until the server's change
 * lands.
 */
export function createNotificationInboxSource(
  options: NotificationInboxSourceOptions
): InboxFeedSource {
  const scopeInput = createMemo(() => encodeInboxScope(options.scope()));
  // A scope with no row types shows nothing, so it reads nothing.
  const enabled = () =>
    options.enabled() && options.scope().rowTypes.length > 0;

  const query = createUrqlInfiniteQuery<
    NotificationInboxQuery,
    NotificationInboxQueryVariables,
    string | null,
    { groups: NotificationInboxGroup[]; cursors: (string | null)[] }
  >(() => {
    const scope = scopeInput();
    return {
      query: NotificationInboxDocument,
      client: options.client(),
      initialPageParam: null,
      variables: (cursor) => inboxPageVariables(scope, cursor),
      getNextPageParam: (lastPage) =>
        lastPage.user.notificationInbox.nextCursor ?? undefined,
      enabled: enabled(),
      requestPolicy: 'cache-and-network',
      keepPreviousData: true,
      select: ({ pages, pageParams }) => ({
        groups: pages
          .flatMap((page) => page.user.notificationInbox.entries)
          .map((entry) => toInboxGroup(entry))
          .filter(isGroup),
        cursors: [...pageParams],
      }),
    };
  });

  const [done, setDone] = createSignal<RowMarks>(new Map());
  const [seen, setSeen] = createSignal<RowMarks>(new Map());
  // Notifications done one at a time. Once the server's row no longer shows
  // one, hiding it does nothing, so it needs no settling.
  const [doneNotifications, setDoneNotifications] = createSignal<
    readonly string[]
  >([]);
  const hideNotification = (id: string, hidden: boolean) =>
    setDoneNotifications((current) =>
      hidden
        ? [...current, id]
        : current.filter((candidate) => candidate !== id)
    );
  // Every change rebuilds the pages. The rows live in a store that each read
  // reconciles into by row id, so a row the change didn't touch keeps its
  // object and a changed one updates in place: what reads them, such as an
  // open preview, reruns only for what changed.
  const [ordered, setOrdered] = createStore<NotificationInboxRow[]>([]);
  createComputed(() =>
    setOrdered(
      reconcile(orderInboxRows(query.data?.groups ?? [], !query.hasNextPage), {
        key: 'id',
        merge: true,
      })
    )
  );

  const live = createLiveAttentionFeed({
    client: options.client,
    cacheHost: options.cacheHost,
    enabled,
    shape: notificationInboxShape,
    query,
    pages: {
      cachedQuery: inboxCachedQuery,
      variables: (cursor) => inboxPageVariables(scopeInput(), cursor),
    },
    updates: {
      document: NotificationInboxUpdatesDocument,
      patches: (data) => data.notificationInboxUpdates,
      variables: () => ({ scope: scopeInput() }),
    },
    onReconnected: options.onReconnected,
    // A done row that left the inbox and returns with the revision it
    // acknowledged was reopened, so it shows again; while it is still
    // loaded, the same revision is a change computed before the done.
    onPatches: (patches) => {
      const present = new Set(ordered.map((row) => row.id));
      const reopened = patches.flatMap((patch) =>
        patch.__typename === 'NotificationInboxEntryUpserted'
          ? patch.entry.rows.flatMap((row) => {
              const acknowledged = done().get(row.id);
              return acknowledged !== undefined &&
                (acknowledged !== row.revision || !present.has(row.id))
                ? [row.id]
                : [];
            })
          : []
      );
      if (reopened.length > 0) {
        setDone((current) => unmarkRows(current, reopened));
      }
    },
    onRefetched: () => {
      setDone((current) => settleRowMarks(current, ordered));
      setSeen((current) => settleRowMarks(current, ordered));
    },
    surface: 'notifications-inbox',
  });

  // Under Unread the server drops a row once it is read. One the reader read
  // here stays listed, read, until the scope changes, so it doesn't vanish
  // while they are on it; a newer copy from the server replaces it.
  const [kept, setKept] = createSignal<readonly NotificationInboxRow[]>([]);
  createComputed(on(scopeInput, () => setKept([])));
  const listed = () => {
    const present = new Set(ordered.map((row) => row.id));
    const extra = kept().filter((row) => !present.has(row.id));
    return extra.length === 0
      ? ordered
      : [...ordered, ...extra].sort(compareInboxRows);
  };

  const rows = createMemo(() =>
    query.data === undefined
      ? undefined
      : withSeenRows(
          withoutDoneNotifications(
            withoutDoneRows(listed(), done()),
            doneNotifications()
          ),
          seen()
        ).filter((row) => options.includeRow?.(row) ?? true)
  );

  /** Patches for a filter that has since changed would add rows it hides. */
  const applyIfCurrent = (
    scope: NotificationInboxScopeInput,
    patches: Parameters<typeof live.applyPatches>[0]
  ) => {
    if (scopeInput() === scope) live.applyPatches(patches);
  };

  const revalidate = (client: Client) =>
    fireAndForget(
      options.revalidateNotifications?.(client),
      'notifications-inbox'
    );

  const markDone = async (targets: readonly NotificationInboxRow[]) => {
    const client = options.client();
    const ids = targets.map((row) => row.id);
    setDone((current) => markRows(current, targets));
    const restoreNotifications = options.overrideNotificationsDone?.(
      targets.flatMap((row) =>
        row.content.notifications.map((notification) => notification.id)
      )
    );
    let undoToken: string;
    try {
      ({ undoToken } = await markInboxRowsDone(client, targets));
    } catch (error) {
      restoreNotifications?.();
      setDone((current) => unmarkRows(current, ids));
      throw error;
    }
    revalidate(client);
    return {
      undo: async () => {
        // The filter may have changed since the done; restore into this one.
        const scope = scopeInput();
        const patches = await undoInboxRowsDone(client, undoToken, scope);
        restoreNotifications?.();
        setDone((current) => unmarkRows(current, ids));
        revalidate(client);
        // The restored places land now rather than with the stream.
        applyIfCurrent(scope, patches);
      },
    };
  };

  const markNotificationDone = async (
    row: NotificationInboxRow,
    notification: UnifiedNotification
  ) => {
    const client = options.client();
    const scope = scopeInput();
    hideNotification(notification.id, true);
    const restoreNotifications = options.overrideNotificationsDone?.([
      notification.id,
    ]);
    let done: Awaited<ReturnType<typeof markInboxNotificationDone>>;
    try {
      done = await markInboxNotificationDone(
        client,
        row.id,
        notification.id,
        scope
      );
    } catch (error) {
      restoreNotifications?.();
      hideNotification(notification.id, false);
      throw error;
    }
    revalidate(client);
    applyIfCurrent(scope, done.patches);
    return {
      undo: async () => {
        // The filter may have changed since the done; restore into this one.
        const undoScope = scopeInput();
        const patches = await undoInboxRowsDone(
          client,
          done.undoToken,
          undoScope
        );
        restoreNotifications?.();
        hideNotification(notification.id, false);
        revalidate(client);
        applyIfCurrent(undoScope, patches);
      },
    };
  };

  const clear = async (request: InboxClear) => {
    const client = options.client();
    const hidden = (rows() ?? []).filter((row) => clearIncludes(request, row));
    const hiddenIds = hidden.map((row) => row.id);
    setDone((current) => markRows(current, hidden));
    const input = {
      scope: encodeInboxScope({
        rowTypes: request.rowTypes,
        unreadOnly: request.unreadOnly,
      }),
      since:
        request.since === undefined
          ? null
          : new Date(request.since).toISOString(),
    };
    const undoTokens: string[] = [];
    let count = 0;
    let cursor: string | null = null;
    try {
      for (let batch = 0; batch < MAX_CLEAR_BATCHES; batch++) {
        const cleared = await clearInboxBatch(client, { ...input, cursor });
        undoTokens.push(cleared.undoToken);
        count += cleared.rowCount;
        cursor = cleared.nextCursor;
        if (!cursor) break;
      }
    } catch (error) {
      // Earlier batches stand; a fresh read shows what is left.
      setDone((current) => unmarkRows(current, hiddenIds));
      fireAndForget(live.refetch(), 'notifications-inbox');
      throw error;
    }
    revalidate(client);
    // Pages past those loaded may hold what moves up into view.
    fireAndForget(live.refetch(), 'notifications-inbox');
    return {
      count,
      undo: async () => {
        // The filter may have changed since the clear; restore into this one.
        const scope = scopeInput();
        for (const token of undoTokens) {
          const patches = await undoInboxRowsDone(client, token, scope);
          applyIfCurrent(scope, patches);
        }
        setDone((current) => unmarkRows(current, hiddenIds));
        revalidate(client);
        fireAndForget(live.refetch(), 'notifications-inbox');
      },
    };
  };

  const markSeen = async (targets: readonly NotificationInboxRow[]) => {
    const unseen = targets.filter((row) => row.unseen);
    if (unseen.length === 0) return;
    const client = options.client();
    const ids = unseen.map((row) => row.id);
    setSeen((current) => markRows(current, unseen));
    if (options.scope().unreadOnly) {
      setKept((current) => [
        ...current.filter((row) => !ids.includes(row.id)),
        ...unseen.map((row) => ({ ...row, unseen: false })),
      ]);
    }
    try {
      const scope = scopeInput();
      const patches = await markInboxRowsSeen(client, ids, scope);
      applyIfCurrent(scope, patches);
    } catch (error) {
      setSeen((current) => unmarkRows(current, ids));
      setKept((current) => current.filter((row) => !ids.includes(row.id)));
      throw error;
    }
    revalidate(client);
  };

  return {
    rows,
    isLoading: () => enabled() && query.isLoading && !query.data,
    error: () => query.error ?? undefined,
    hasMore: () => enabled() && query.hasNextPage && !query.error,
    isLoadingMore: () => query.isFetchingNextPage,
    loadMore: async () => {
      if (!query.hasNextPage || query.isFetchingNextPage) return;
      await query.fetchNextPage();
    },
    refresh: live.refetch,
    markDone,
    markNotificationDone,
    clear,
    markSeen,
  };
}
