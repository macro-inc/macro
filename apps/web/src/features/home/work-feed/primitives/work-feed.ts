import type {
  MarkDoneDelegate,
  PreparedMarkDone,
} from '@app/features/next-soup/actions/mark-done-delegate';
import type { EntityData } from '@entity';
import type { CacheHost } from '@graphql-cache/host/types';
import { setDoneOverride } from '@notifications/notification-source';
import type { WorkFeedPatchFieldsFragment } from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import {
  markWorkFeedDone,
  settleWorkFeedDone,
  unmarkWorkFeedDone,
  type WorkFeedDone,
  type WorkFeedEntry,
  type WorkFeedScope,
  withoutDoneWorkFeedEntries,
  workFeedEntityKey,
} from '../core/work-feed';
import { writeWorkFeedPatches } from '../queries/work-feed-cache';
import {
  markWorkFeedItemsDone,
  undoWorkFeedItemsDone,
} from '../queries/work-feed-mutations';
import {
  createWorkFeedQuery,
  workFeedPageVariables,
} from '../queries/work-feed-query';
import { subscribeToWorkFeedUpdates } from '../queries/work-feed-updates';

/** First delay before following a feed again after its live stream ended. */
export const WORK_FEED_RESUBSCRIBE_DELAY_MS = 3_000;
/** Longest delay between attempts while the live stream keeps failing. */
export const WORK_FEED_MAX_RESUBSCRIBE_DELAY_MS = 60_000;

export type WorkFeedOptions = {
  client: Accessor<Client>;
  /** The normalized cache holding the feed's pages, when it is available. */
  cacheHost: Accessor<Pick<CacheHost, 'readQuery' | 'writeQuery'> | undefined>;
  scope: Accessor<WorkFeedScope>;
  enabled: Accessor<boolean>;
  /** Subscribes to transport reconnects, after which changes may be missed. */
  onReconnected?: (listener: () => void) => () => void;
  /** Reconciles other notification readers after a done or undo commits. */
  revalidateNotifications?: (client: Client) => Promise<void>;
};

/** Raw notification ids an entry's row shows, for local done overrides. */
function notificationIds(entry: WorkFeedEntry): string[] {
  const notifications = entry.entity.notifications;
  const list =
    typeof notifications === 'function' ? notifications() : notifications;
  return (list ?? []).map((notification) => notification.id);
}

/**
 * One live work feed. The server sends each change already placed in the
 * feed, and the change is written into the cached pages, so the paged query
 * shows it without a network read. The feed reads again only when changes
 * may have been missed. Its `markDone` delegate completes rows as feed
 * items, hiding them until their removal arrives, with undo.
 */
export function createWorkFeed(options: WorkFeedOptions) {
  const query = createWorkFeedQuery(options);
  const [done, setDone] = createSignal<WorkFeedDone>(new Map());
  const loaded = () => query.data?.entries ?? [];

  // A read requested while one runs is followed by one more.
  let refetching = false;
  let refetchAgain = false;
  const refetch = async () => {
    if (refetching) {
      refetchAgain = true;
      return;
    }
    refetching = true;
    try {
      do {
        refetchAgain = false;
        await query.refetch({ requestPolicy: 'network-only' });
        setDone((current) => settleWorkFeedDone(current, loaded()));
      } while (refetchAgain);
    } catch (error) {
      console.warn('Work feed refresh failed', error);
    } finally {
      refetching = false;
    }
  };

  // Batches are written in arrival order, and only between page reads, so a
  // read that started before a batch cannot land over it.
  let pending: WorkFeedPatchFieldsFragment[] = [];
  let writing = false;
  const writePending = async () => {
    if (writing || pending.length === 0 || query.isFetching) return;
    const host = options.cacheHost();
    const batch = pending;
    pending = [];
    // Without the cache there are no pages to place changes in.
    if (!host) {
      void refetch();
      return;
    }
    writing = true;
    try {
      const pages = query.data?.cursors ?? [];
      const placed = await writeWorkFeedPatches(
        host,
        pages.map((cursor) => workFeedPageVariables(options.scope(), cursor)),
        batch,
        query.hasNextPage
      );
      if (!placed) void refetch();
    } catch (error) {
      console.warn('Work feed update failed', error);
      void refetch();
    } finally {
      writing = false;
      void writePending();
    }
  };
  createEffect(
    on(
      () => query.isFetching,
      (fetching) => {
        if (!fetching) void writePending();
      }
    )
  );

  const applyPatches = (patches: readonly WorkFeedPatchFieldsFragment[]) => {
    // A done item that left the feed and returns with the reasons it
    // acknowledged was reopened, so it shows again; while it is still
    // loaded, the same revision is a change computed before the done.
    const present = new Set(loaded().map((entry) => entry.itemId));
    const reopened = patches.flatMap((patch) => {
      if (patch.__typename !== 'WorkFeedEntryUpserted') return [];
      const { item, revision } = patch.entry;
      const acknowledged = done().get(item.id);
      return acknowledged !== undefined &&
        (acknowledged !== revision || !present.has(item.id))
        ? [item.id]
        : [];
    });
    if (reopened.length > 0) {
      setDone((current) => unmarkWorkFeedDone(current, reopened));
    }
    pending.push(...patches);
    void writePending();
  };

  // The live stream is an external system: follow it while the feed is
  // enabled, and again with each new client or scope.
  createEffect(() => {
    if (!options.enabled()) return;
    const client = options.client();
    const scope = options.scope();
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = WORK_FEED_RESUBSCRIBE_DELAY_MS;
    let unsubscribe = () => {};
    const follow = () => {
      unsubscribe = subscribeToWorkFeedUpdates(client, scope, {
        patches: (patches) => {
          delay = WORK_FEED_RESUBSCRIBE_DELAY_MS;
          applyPatches(patches);
        },
        interrupted: () => {
          if (disposed) return;
          retry = setTimeout(() => {
            if (disposed) return;
            follow();
            // Changes made while the stream was down are only in a read.
            void refetch();
          }, delay);
          delay = Math.min(delay * 2, WORK_FEED_MAX_RESUBSCRIBE_DELAY_MS);
        },
      });
    };
    follow();
    const stopReconnects = options.onReconnected?.(() => void refetch());
    onCleanup(() => {
      disposed = true;
      pending = [];
      if (retry !== undefined) clearTimeout(retry);
      unsubscribe();
      stopReconnects?.();
    });
  });

  const entries = createMemo(() =>
    withoutDoneWorkFeedEntries(loaded(), done())
  );
  const entriesByEntity = createMemo(
    () =>
      new Map(
        entries().map((entry) => [workFeedEntityKey(entry.entity), entry])
      )
  );

  const canComplete = (entity: EntityData) =>
    entriesByEntity().get(workFeedEntityKey(entity))?.hasAttention;

  const prepare = (
    entities: readonly EntityData[]
  ): PreparedMarkDone | undefined => {
    const targets: WorkFeedEntry[] = [];
    for (const entity of entities) {
      const entry = entriesByEntity().get(workFeedEntityKey(entity));
      if (!entry) return undefined;
      // Own work alone has nothing to acknowledge.
      if (entry.hasAttention) targets.push(entry);
    }
    if (targets.length === 0) return undefined;
    const items = targets.map(({ itemId, revision }) => ({ itemId, revision }));
    // Done leaves own work in place: those rows stay, turning read, and move
    // to their own-work time when the server's change arrives.
    const leaving = targets
      .filter((entry) => !entry.hasOwnWork)
      .map(({ itemId, revision }) => ({ itemId, revision }));
    const client = options.client();
    const scope = options.scope();
    return {
      hide: () => {
        setDone((current) => markWorkFeedDone(current, leaving));
        // Rows that stay read as done, and readers of the shared
        // notification source drop these notifications too.
        const restoreNotifications = setDoneOverride(
          targets.flatMap(notificationIds),
          true
        );
        return () => {
          restoreNotifications();
          setDone((current) =>
            unmarkWorkFeedDone(
              current,
              leaving.map((item) => item.itemId)
            )
          );
        };
      },
      // The server publishes the done to every session's live stream,
      // which removes or moves the rows; no read is needed.
      commit: async () => {
        const { undoToken } = await markWorkFeedItemsDone(client, items);
        void options.revalidateNotifications?.(client);
        return {
          undo: async () => {
            const patches = await undoWorkFeedItemsDone(
              client,
              undoToken,
              scope
            );
            void options.revalidateNotifications?.(client);
            // The restored places land now rather than with the stream.
            applyPatches(patches);
          },
        };
      },
    };
  };
  const markDone: MarkDoneDelegate = { canComplete, prepare };

  return { query, entries, refetch, markDone };
}
