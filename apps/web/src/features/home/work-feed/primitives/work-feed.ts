import type {
  MarkDoneDelegate,
  PreparedMarkDone,
} from '@app/features/next-soup/actions/mark-done-delegate';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData } from '@entity';
import type { CacheHost } from '@graphql-cache/host/types';
import { setDoneOverride } from '@notifications/notification-source';
import { createLiveAttentionFeed } from '@queries/attention-feed/live-attention-feed';
import {
  WorkFeedDocument,
  type WorkFeedPatchFieldsFragment,
  WorkFeedUpdatesDocument,
} from '@service-storage/graphql/generated/graphql';
import { type Client, stringifyDocument } from '@urql/core';
import { type Accessor, createMemo, createSignal } from 'solid-js';
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
import { encodeWorkFeedScope } from '../queries/decode';
import {
  markWorkFeedItemsDone,
  undoWorkFeedItemsDone,
} from '../queries/work-feed-mutations';
import {
  createWorkFeedQuery,
  workFeedPageVariables,
} from '../queries/work-feed-query';
import { workFeedShape } from '../queries/work-feed-shape';

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

const workFeedCachedQuery = {
  query: stringifyDocument(WorkFeedDocument),
  operationName: 'WorkFeed',
};

/** Raw notification ids an entry's row shows, for local done overrides. */
function notificationIds(entry: WorkFeedEntry): string[] {
  const notifications = entry.entity.notifications;
  const list =
    typeof notifications === 'function' ? notifications() : notifications;
  return (list ?? []).map((notification) => notification.id);
}

/**
 * One live Home work feed. Its `markDone` delegate completes rows as feed
 * items, hiding them until their removal arrives, with undo.
 */
export function createWorkFeed(options: WorkFeedOptions) {
  const query = createWorkFeedQuery(options);
  const [done, setDone] = createSignal<WorkFeedDone>(new Map());
  const loaded = () => query.data?.entries ?? [];

  const live = createLiveAttentionFeed({
    client: options.client,
    cacheHost: options.cacheHost,
    enabled: options.enabled,
    shape: workFeedShape,
    query,
    pages: {
      cachedQuery: workFeedCachedQuery,
      variables: (cursor) => workFeedPageVariables(options.scope(), cursor),
    },
    updates: {
      document: WorkFeedUpdatesDocument,
      patches: (data) => data.workFeedUpdates,
      variables: () => ({ scope: encodeWorkFeedScope(options.scope()) }),
    },
    onReconnected: options.onReconnected,
    // A done item that left the feed and returns with the reasons it
    // acknowledged was reopened, so it shows again; while it is still
    // loaded, the same revision is a change computed before the done.
    onPatches: (patches) => {
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
    },
    onRefetched: () =>
      setDone((current) => settleWorkFeedDone(current, loaded())),
    surface: 'home',
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
        fireAndForget(options.revalidateNotifications?.(client), 'home');
        return {
          undo: async () => {
            const patches: WorkFeedPatchFieldsFragment[] =
              await undoWorkFeedItemsDone(client, undoToken, scope);
            fireAndForget(options.revalidateNotifications?.(client), 'home');
            // The restored places land now rather than with the stream.
            live.applyPatches(patches);
          },
        };
      },
    };
  };
  const markDone: MarkDoneDelegate = { canComplete, prepare };

  return { query, entries, refetch: live.refetch, markDone };
}
