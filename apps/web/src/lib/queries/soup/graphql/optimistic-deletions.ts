import { fireAndForget } from '@core/util/fireAndForget';
import { skipToken, useMutationState, useQuery } from '@tanstack/solid-query';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
} from 'solid-js';
import { z } from 'zod';
import {
  currentQueryAccount,
  isCurrentQueryAccount,
  queryAccountSession,
} from '../../auth/account-scope';
import { queryClient } from '../../client';
import type { SoupAstItemsData } from '../items';
import { soupEntityKey } from './entity-input';
import { graphqlSoupKeys } from './keys';

export const GRAPHQL_SOUP_DELETE_MUTATION_KEY = [
  'graphql-soup',
  'delete',
] as const;

export const GRAPHQL_SOUP_DELETE_RETENTION_MS = 60_000;
const RETAINED_DELETIONS_KEY = graphqlSoupKeys.retainedDeletions.queryKey;
const EMPTY_DELETE_KEYS: readonly string[] = [];
type RetainedDeletions = GraphqlSoupDeletion[];
type DeletionReader = (keys: ReadonlySet<string>) => Iterable<string>;
const readerRegistries = new WeakMap<
  typeof queryClient,
  ReturnType<typeof createSignal<readonly DeletionReader[]>>
>();

function deletionReaderRegistry() {
  const existing = readerRegistries.get(queryClient);
  if (existing) return existing;
  const registry = createSignal<readonly DeletionReader[]>([]);
  readerRegistries.set(queryClient, registry);
  return registry;
}

const restoreReceipt = z.object({
  viewerId: z.string(),
  startedAt: z.number(),
  keys: z.array(z.string()),
});
let restoreChannel: BroadcastChannel | null | undefined;
function getRestoreChannel() {
  if (restoreChannel !== undefined) return restoreChannel;
  try {
    restoreChannel = new BroadcastChannel('macro:soup-restore');
  } catch {
    restoreChannel = null;
  }
  return restoreChannel;
}
export const soupOperationTime = () =>
  performance.timeOrigin + performance.now();

/** A live list may still show its previous snapshot after the cache confirms a tombstone. */
export function observeGraphqlSoupDeletions(reader: DeletionReader) {
  const [, setDeletionReaders] = deletionReaderRegistry();
  setDeletionReaders((readers) => [...readers, reader]);
  onCleanup(() =>
    setDeletionReaders((readers) => readers.filter((entry) => entry !== reader))
  );
}

export type GraphqlSoupDeletion = {
  keys: Accessor<readonly string[]>;
  /** Restore failed keys immediately. Retire confirmed keys when their lists catch up. */
  settle: (
    deletedKeys: readonly string[],
    acknowledgements?: ReadonlyMap<string, Promise<boolean>>,
    historyOnlyKeys?: ReadonlySet<string>,
    dispatchedAt?: ReadonlyMap<string, number>
  ) => void;
  release: () => void;
  /** Retire only keys confirmed restored after this deletion began. */
  restore: (keys: readonly string[]) => void;
};

/** Retain normalized `typename:id` keys through the list's acknowledgement. */
export function createGraphqlSoupDeletion(
  keys: readonly string[]
): GraphqlSoupDeletion {
  const session = queryAccountSession();
  const account = currentQueryAccount();
  const targetKeys = new Set(keys);
  const [pendingKeys, setDeletedKeys] = createSignal(keys);
  const deletedKeys = () =>
    session === queryAccountSession() ? pendingKeys() : EMPTY_DELETE_KEYS;
  let settled = false;
  let released = false;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let detachReaders: (() => void) | undefined;
  let unsubscribeRestores: (() => void) | undefined;
  const restoredKeys = new Set<string>();
  const peerRestores = new Map<string, number>();
  let dispatches: ReadonlyMap<string, number> | undefined;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(expiryTimer);
    detachReaders?.();
    unsubscribeRestores?.();
    setDeletedKeys([]);
    queryClient.setQueryData<RetainedDeletions>(
      RETAINED_DELETIONS_KEY,
      (retained) => retained?.filter((entry) => entry.keys !== deletedKeys)
    );
  };
  const deletion: GraphqlSoupDeletion = {
    keys: deletedKeys,
    release,
    restore: (keys) => {
      if (released) return;
      for (const key of keys) {
        if (targetKeys.has(key)) restoredKeys.add(key);
      }
      setDeletedKeys((previous) =>
        previous.filter((key) => !restoredKeys.has(key))
      );
      if (deletedKeys().length === 0) release();
    },
    settle: (
      successfulKeys,
      acknowledgements,
      historyOnlyKeys,
      dispatchedAt
    ) => {
      if (settled || released) return;
      settled = true;
      dispatches = dispatchedAt;
      for (const [key, restoreStartedAt] of peerRestores) {
        if (restoreStartedAt > (dispatches?.get(key) ?? Infinity))
          restoredKeys.add(key);
      }
      peerRestores.clear();
      setDeletedKeys(
        [...new Set(successfulKeys)].filter((key) => !restoredKeys.has(key))
      );
      if (deletedKeys().length === 0) {
        release();
        return;
      }
      // A mutation observer can detach before the API finishes, starting its
      // GC clock early. Keep confirmed keys outside that mutation's lifetime.
      queryClient.setQueryData<RetainedDeletions>(
        RETAINED_DELETIONS_KEY,
        (retained) => [...(retained ?? []), deletion]
      );
      // Collect keys with no stale readers even if reconciliation hung.
      // A visible stale row must stay hidden past the retention deadline.
      const [retentionElapsed, setRetentionElapsed] = createSignal(false);
      expiryTimer = setTimeout(
        () => setRetentionElapsed(true),
        GRAPHQL_SOUP_DELETE_RETENTION_MS
      );
      const acknowledged = new Set<string>();
      const [deletionReaders] = deletionReaderRegistry();
      const [acknowledgementCount, setAcknowledgementCount] = createSignal(0);
      let notifyScheduled = false;
      createRoot((dispose) => {
        detachReaders = dispose;
        let version = 0;
        createEffect(() => {
          const observed = ++version;
          const keys = deletedKeys();
          if (keys.length === 0) {
            queueMicrotask(release);
            return;
          }
          const expired = retentionElapsed();
          const hasAcknowledgements = acknowledgementCount() > 0;
          if (!expired && !hasAcknowledgements) return;
          const ready = new Set(
            keys.filter((key) => expired || acknowledged.has(key))
          );
          if (ready.size === 0) return;
          for (const read of deletionReaders()) {
            for (const key of read(ready)) {
              // A history removal leaves the entity in other lists.
              if (!historyOnlyKeys?.has(key)) ready.delete(key);
            }
            if (ready.size === 0) return;
          }
          queueMicrotask(() => {
            if (observed === version) deletion.restore([...ready]);
          });
        });
      }, null);
      const acknowledge = async (key: string, receipt: Promise<boolean>) => {
        if (!(await receipt) || released) return;
        acknowledged.add(key);
        // A bulk write can confirm many keys at once. Recheck lists once
        // for that group of receipts.
        if (notifyScheduled) return;
        notifyScheduled = true;
        queueMicrotask(() => {
          notifyScheduled = false;
          setAcknowledgementCount(acknowledged.size);
        });
      };
      for (const key of deletedKeys()) {
        const receipt = acknowledgements?.get(key);
        if (receipt)
          fireAndForget(acknowledge(key, receipt), 'soup-optimistic-deletions');
      }
    },
  };
  if (account) {
    const channel = getRestoreChannel();
    const onRestore = (event: MessageEvent) => {
      const { data: receipt } = restoreReceipt.safeParse(event.data);
      if (
        receipt?.viewerId === account.userId &&
        isCurrentQueryAccount(account)
      ) {
        for (const key of receipt.keys) {
          if (!targetKeys.has(key)) continue;
          if (settled) {
            if (receipt.startedAt > (dispatches?.get(key) ?? Infinity))
              deletion.restore([key]);
          } else if (receipt.startedAt > (peerRestores.get(key) ?? 0)) {
            // The delete may still be waiting on access. Decide once its actual
            // dispatch time is available.
            peerRestores.set(key, receipt.startedAt);
          }
        }
      }
    };
    channel?.addEventListener('message', onRestore);
    unsubscribeRestores = () =>
      channel?.removeEventListener('message', onRestore);
  }
  return deletion;
}

/** Snapshot before the restore request: a later delete must keep its own intent.
 * Call the returned function only after server confirmation. Retained entries
 * survive mutation GC, so consult both sources. */
export function prepareGraphqlSoupRestore() {
  const account = currentQueryAccount();
  const startedAt = soupOperationTime();
  const deletions = new Set([
    ...(queryClient.getQueryData<RetainedDeletions>(RETAINED_DELETIONS_KEY) ??
      []),
    ...queryClient
      .getMutationCache()
      .findAll({
        mutationKey: GRAPHQL_SOUP_DELETE_MUTATION_KEY,
        exact: true,
      })
      .flatMap((mutation) => {
        const deletion = (
          mutation.state.context as GraphqlSoupDeleteContext | undefined
        )?.graphqlDeletion;
        return deletion ? [deletion] : [];
      }),
  ]);
  return (restoredKeys: readonly string[]) => {
    batch(() => {
      for (const deletion of deletions) deletion.restore(restoredKeys);
    });
    if (account && isCurrentQueryAccount(account) && restoredKeys.length > 0) {
      getRestoreChannel()?.postMessage({
        viewerId: account.userId,
        startedAt,
        keys: [...restoredKeys],
      });
    }
  };
}

/** Only GraphQL-enabled bulk deletes opt into the display overlay. */
export type GraphqlSoupDeleteContext = {
  graphqlDeletion?: GraphqlSoupDeletion;
};

/** Reflect pending and confirmed deletions in GraphQL views. Completed
 * mutations retain their own tombstones until readers acknowledge them,
 * a restore supersedes them, or the retention deadline passes with no stale reader.
 */
export function usePendingGraphqlSoupDeleteKeys() {
  const retained = useQuery(
    () => ({
      queryKey: RETAINED_DELETIONS_KEY,
      queryFn: skipToken,
      initialData: [] as RetainedDeletions,
      // One empty index may live for the session. Entries without stale readers
      // are collected even when no view is mounted to observe this query.
      gcTime: Infinity,
    }),
    () => queryClient
  );
  const deletions = useMutationState(
    () => ({
      filters: {
        mutationKey: GRAPHQL_SOUP_DELETE_MUTATION_KEY,
        exact: true,
      },
      select: (mutation) =>
        (mutation.state.context as GraphqlSoupDeleteContext | undefined)
          ?.graphqlDeletion?.keys,
    }),
    () => queryClient
  );
  return createMemo<ReadonlySet<string>>(
    () =>
      new Set([
        ...deletions().flatMap((keys) => keys?.() ?? []),
        ...(retained.isSuccess
          ? retained.data.flatMap((entry) => entry.keys())
          : []),
      ])
  );
}

/** Preserve unaffected rows and array identity, including when no delete is pending. */
export function withoutPendingSoupEntities<T extends { id: string }>(
  entities: T[],
  deletedKeys: ReadonlySet<string>,
  keyOf: (entity: T) => string | undefined = (entity) => entity.id
): T[] {
  const deleted = (entity: T) => {
    const key = keyOf(entity);
    return key !== undefined && deletedKeys.has(key);
  };
  if (deletedKeys.size === 0 || !entities.some(deleted)) return entities;
  return entities.filter((entity) => !deleted(entity));
}

/** Apply typed deletions after reconciliation; ID-only selectors remain available for Done. */
export function withoutPendingGraphqlSoupDeletes(
  data: SoupAstItemsData | undefined,
  deletedKeys: ReadonlySet<string>,
  identity: 'entity' | 'id' = 'entity'
): SoupAstItemsData | undefined {
  const keyOf =
    identity === 'entity'
      ? soupEntityKey
      : (entity: { id: string }) => entity.id;
  if (!data || deletedKeys.size === 0) return data;
  const entities = withoutPendingSoupEntities(
    data.entities,
    deletedKeys,
    keyOf
  );
  const visibleIds = new Set(entities.map(({ id }) => id));
  const removedIds = new Set(
    data.entities.filter(({ id }) => !visibleIds.has(id)).map(({ id }) => id)
  );
  const itemsById = data.itemsById;
  const removedItemIds: string[] = [];
  for (const [id, item] of Object.entries(itemsById ?? {})) {
    const key =
      identity === 'entity' ? soupEntityKey({ type: item.tag, id }) : id;
    if (key !== undefined && deletedKeys.has(key)) {
      removedIds.add(id);
      removedItemIds.push(id);
    } else {
      removedIds.delete(id);
    }
  }
  if (entities === data.entities && removedIds.size === 0) return data;
  const groups = data.groups?.map((group) => {
    const itemIds = group.itemIds.filter((id) => !removedIds.has(id));
    const removed = group.itemIds.length - itemIds.length;
    return removed === 0
      ? group
      : {
          ...group,
          itemIds,
          totalCount: Math.max(0, group.totalCount - removed),
        };
  });
  const remainingItems =
    removedItemIds.length > 0 ? { ...itemsById } : itemsById;
  if (remainingItems) {
    for (const id of removedItemIds) delete remainingItems[id];
  }
  return { ...data, entities, groups, itemsById: remainingItems };
}
