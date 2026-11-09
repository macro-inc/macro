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
import { v7 as uuid7 } from 'uuid';
import type {
  InboxFeedSource,
  InboxScope,
  NotificationInboxRow,
} from '../context/notifications-inbox-context';
import { clearHides, isClearRunning } from '../core/inbox-clear';
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
import { encodeClearScope, encodeInboxScope, toInboxGroup } from './decode';
import { createInboxClears } from './inbox-clears';
import {
  type NotificationInboxGroup,
  orderInboxRows,
} from './notification-inbox-groups';
import {
  clearInbox,
  markInboxNotificationDone,
  markInboxRowsDone,
  markInboxRowsSeen,
  readInboxClears,
  undoInboxClear,
  undoInboxRowsDone,
} from './notification-inbox-mutations';
import { notificationInboxShape } from './notification-inbox-shape';

/** Entries fetched per inbox page. */
export const INBOX_PAGE_LIMIT = 50;

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
  client: Accessor<Client>;
  /** The normalized cache holding the inbox's pages, when it is available. */
  cacheHost: Accessor<Pick<CacheHost, 'readQuery' | 'writeQuery'> | undefined>;
  scope: Accessor<InboxScope>;
  enabled: Accessor<boolean>;
  /** Subscribes to transport reconnects, after which changes may be missed. */
  onReconnected?: (listener: () => void) => () => void;
  /**
   * Subscribes, under the caller's owner, to the server's hints that one of
   * the viewer's clears changed, on any device.
   */
  onClearUpdated?: (listener: (clearId: string) => void) => void;
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

  const revalidate = (client: Client) =>
    fireAndForget(
      options.revalidateNotifications?.(client),
      'notifications-inbox'
    );

  // Clears the server is still working through, from this device or
  // another. Their rows are hidden at once; when one ends, or is undone,
  // the inbox is read again.
  const clears = createInboxClears({
    client: options.client,
    enabled,
    onClearUpdated: options.onClearUpdated,
    onReconnected: options.onReconnected,
    onSettled: () => {
      revalidate(options.client());
      fireAndForget(live.refetch(), 'notifications-inbox');
    },
  });

  const rows = createMemo(() => {
    if (query.data === undefined) return undefined;
    const running = clears.running();
    const shown = withSeenRows(
      withoutDoneNotifications(
        withoutDoneRows(listed(), done()),
        doneNotifications()
      ),
      seen()
    );
    return running.length === 0
      ? shown
      : shown.filter((row) => !running.some((clear) => clearHides(clear, row)));
  });

  /** Patches for a filter that has since changed would add rows it hides. */
  const applyIfCurrent = (
    scope: NotificationInboxScopeInput,
    patches: Parameters<typeof live.applyPatches>[0]
  ) => {
    if (scopeInput() === scope) live.applyPatches(patches);
  };

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
    // Nothing to take: every kind is hidden. A clear always names its kinds.
    if (request.rowTypes.length === 0) {
      return { count: 0, complete: true, undo: async () => {} };
    }
    const client = options.client();
    const hidden = (rows() ?? []).filter((row) => clearIncludes(request, row));
    const hiddenIds = hidden.map((row) => row.id);
    setDone((current) => markRows(current, hidden));
    // The id makes the clear the server's from the first request: sent
    // again, or read back after a lost reply, it is the same clear.
    const clearId = uuid7();
    let cleared: Awaited<ReturnType<typeof clearInbox>>;
    try {
      cleared = await clearInbox(client, {
        clearId,
        scope: encodeClearScope({
          rowTypes: request.rowTypes,
          unreadOnly: request.unreadOnly,
        }),
        since:
          request.since === undefined
            ? null
            : new Date(request.since).toISOString(),
      });
    } catch (error) {
      // The reply may be all that was lost; the server then has the clear.
      const [started] = await readInboxClears(client, clearId).catch(() => []);
      if (!started) {
        setDone((current) => unmarkRows(current, hiddenIds));
        fireAndForget(live.refetch(), 'notifications-inbox');
        throw error;
      }
      cleared = started;
    }
    const complete = !isClearRunning(cleared.status);
    if (!complete) clears.observe(cleared);
    revalidate(client);
    // Pages past those loaded may hold what moves up into view.
    fireAndForget(live.refetch(), 'notifications-inbox');
    return {
      count: cleared.rows,
      complete,
      // Resolves when the server finishes: to its final count, or to
      // undefined when the clear was undone or stopped instead.
      finished: complete
        ? undefined
        : (async () => {
            const ended = await clears.settled(clearId);
            return ended?.status === 'done' ? ended.rows : undefined;
          })(),
      undo: async () => {
        // The rows come back at once; the server restores each to the state
        // it had, and stops the clear first if it is still at work.
        setDone((current) => unmarkRows(current, hiddenIds));
        let undone: Awaited<ReturnType<typeof undoInboxClear>>;
        try {
          undone = await undoInboxClear(client, clearId);
        } catch (error) {
          setDone((current) => markRows(current, hidden));
          throw error;
        }
        if (undone && isClearRunning(undone.status)) {
          // The server finishes the undo; the inbox is read again then.
          clears.observe(undone);
          await clears.settled(clearId);
          return;
        }
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
