import { createUrqlInfiniteQuery } from '@app/lib/urql-solid/create-urql-infinite-query';
import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/host/types';
import { createLiveAttentionFeed } from '@queries/attention-feed/live-attention-feed';
import {
  NotificationInboxDocument,
  type NotificationInboxQuery,
  type NotificationInboxQueryVariables,
  type NotificationInboxScopeInput,
  NotificationInboxUpdatesDocument,
} from '@service-storage/graphql/generated/graphql';
import { type Client, stringifyDocument } from '@urql/core';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import type {
  InboxFeedSource,
  InboxScope,
  NotificationInboxRow,
} from '../context/notifications-inbox-context';
import {
  markRows,
  type RowMarks,
  settleRowMarks,
  unmarkRows,
  withoutDoneRows,
  withSeenRows,
} from '../core/inbox-row';
import { encodeInboxScope, toInboxGroup } from './decode';
import {
  type NotificationInboxGroup,
  orderInboxRows,
} from './notification-inbox-groups';
import {
  markInboxRowsDone,
  markInboxRowsSeen,
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
          .map(toInboxGroup)
          .filter(isGroup),
        cursors: [...pageParams],
      }),
    };
  });

  const [done, setDone] = createSignal<RowMarks>(new Map());
  const [seen, setSeen] = createSignal<RowMarks>(new Map());
  const ordered = createMemo(() =>
    orderInboxRows(query.data?.groups ?? [], !query.hasNextPage)
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
      const present = new Set(ordered().map((row) => row.id));
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
      setDone((current) => settleRowMarks(current, ordered()));
      setSeen((current) => settleRowMarks(current, ordered()));
    },
    surface: 'notifications-inbox',
  });

  const rows = createMemo(() =>
    query.data === undefined
      ? undefined
      : withSeenRows(withoutDoneRows(ordered(), done()), seen())
  );

  const revalidate = (client: Client) =>
    fireAndForget(
      options.revalidateNotifications?.(client),
      'notifications-inbox'
    );

  const markDone = async (targets: readonly NotificationInboxRow[]) => {
    const client = options.client();
    const scope = scopeInput();
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
        const patches = await undoInboxRowsDone(client, undoToken, scope);
        restoreNotifications?.();
        setDone((current) => unmarkRows(current, ids));
        revalidate(client);
        // The restored places land now rather than with the stream.
        live.applyPatches(patches);
      },
    };
  };

  const markSeen = async (targets: readonly NotificationInboxRow[]) => {
    const unseen = targets.filter((row) => row.unseen);
    if (unseen.length === 0) return;
    const client = options.client();
    const ids = unseen.map((row) => row.id);
    setSeen((current) => markRows(current, unseen));
    try {
      const patches = await markInboxRowsSeen(client, ids, scopeInput());
      live.applyPatches(patches);
    } catch (error) {
      setSeen((current) => unmarkRows(current, ids));
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
    markSeen,
  };
}
