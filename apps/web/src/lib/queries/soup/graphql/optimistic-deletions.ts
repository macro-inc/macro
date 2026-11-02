import { fireAndForget } from '@core/util/fireAndForget';
import { skipToken, useMutationState, useQuery } from '@tanstack/solid-query';
import { type Accessor, batch, createMemo, createSignal } from 'solid-js';
import { queryClient } from '../../client';
import type { SoupAstItemsData } from '../items';
import { refreshActiveGraphqlSoupQueries } from './active-queries';
import { soupEntityKey } from './entity-input';
import { graphqlSoupKeys } from './keys';

export const GRAPHQL_SOUP_DELETE_MUTATION_KEY = [
  'graphql-soup',
  'delete',
] as const;

export const GRAPHQL_SOUP_DELETE_RETENTION_MS = 60_000;
const REVALIDATION_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;
const RETAINED_DELETIONS_KEY = graphqlSoupKeys.retainedDeletions.queryKey;
type RetainedDeletions = GraphqlSoupDeletion[];

export type GraphqlSoupDeletion = {
  keys: Accessor<readonly string[]>;
  /** Restore failed keys immediately and revalidate the confirmed deletions. */
  settle: (deletedKeys: readonly string[]) => void;
  release: () => void;
  /** Retire only keys confirmed restored after this deletion began. */
  restore: (keys: readonly string[]) => void;
};

/** Retain normalized `typename:id` keys until revalidation, release, or expiry. */
export function createGraphqlSoupDeletion(
  keys: readonly string[]
): GraphqlSoupDeletion {
  const [deletedKeys, setDeletedKeys] = createSignal(keys);
  let settled = false;
  let released = false;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const restoredKeys = new Set<string>();
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(expiryTimer);
    clearTimeout(retryTimer);
    setDeletedKeys([]);
    queryClient.setQueryData<RetainedDeletions>(
      RETAINED_DELETIONS_KEY,
      (retained) => retained?.filter((entry) => entry.keys !== deletedKeys)
    );
  };
  const revalidate = async (attempt: number): Promise<void> => {
    try {
      await refreshActiveGraphqlSoupQueries({ throwOnError: true });
      release();
    } catch {
      if (released || attempt + 1 >= REVALIDATION_ATTEMPTS) return;
      retryTimer = setTimeout(
        () => {
          retryTimer = undefined;
          fireAndForget(revalidate(attempt + 1), 'soup-optimistic-deletions');
        },
        RETRY_DELAY_MS * 2 ** attempt
      );
    }
  };
  const deletion: GraphqlSoupDeletion = {
    keys: deletedKeys,
    release,
    restore: (keys) => {
      if (released) return;
      for (const key of keys) restoredKeys.add(key);
      setDeletedKeys((previous) =>
        previous.filter((key) => !restoredKeys.has(key))
      );
      if (deletedKeys().length === 0) release();
    },
    settle: (successfulKeys) => {
      if (settled || released) return;
      settled = true;
      setDeletedKeys(
        [...new Set(successfulKeys)].filter((key) => !restoredKeys.has(key))
      );
      if (deletedKeys().length === 0) {
        release();
        // Reconcile uncertain failures without retaining a failed deletion.
        if (keys.length > 0)
          fireAndForget(revalidate(0), 'soup-optimistic-deletions');
        return;
      }
      // A mutation observer can detach before the API finishes, starting its
      // GC clock early. Keep confirmed keys outside that mutation's lifetime.
      queryClient.setQueryData<RetainedDeletions>(
        RETAINED_DELETIONS_KEY,
        (retained) => [...(retained ?? []), deletion]
      );
      // Cleanup is independent of hung refresh promises and query lifetime.
      expiryTimer = setTimeout(release, GRAPHQL_SOUP_DELETE_RETENTION_MS);
      fireAndForget(revalidate(0), 'soup-optimistic-deletions');
    },
  };
  return deletion;
}

/** Snapshot before the restore request: a later delete must keep its own intent.
 * Call the returned function only after server confirmation. Retained entries
 * survive mutation GC, so consult both sources. */
export function prepareGraphqlSoupRestore() {
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
  return (restoredKeys: readonly string[]) =>
    batch(() => {
      for (const deletion of deletions) deletion.restore(restoredKeys);
    });
}

/** Only GraphQL-enabled bulk deletes opt into the display overlay. */
export type GraphqlSoupDeleteContext = {
  graphqlDeletion?: GraphqlSoupDeletion;
};

/** Reflect pending and confirmed deletions in GraphQL views. Completed
 * mutations retain their own tombstones until strict revalidation or expiry.
 */
export function usePendingGraphqlSoupDeleteKeys() {
  const retained = useQuery(
    () => ({
      queryKey: RETAINED_DELETIONS_KEY,
      queryFn: skipToken,
      initialData: [] as RetainedDeletions,
      // One empty index may live for the client session; its entries always have
      // bounded lifetimes, even when no view is mounted to observe this query.
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
