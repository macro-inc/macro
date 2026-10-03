import { skipToken, useMutationState, useQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { queryClient } from '../../client';
import type { SoupAstItemsData } from '../items';
import { refreshActiveGraphqlSoupQueries } from './active-queries';
import { graphqlSoupKeys } from './keys';

export const GRAPHQL_SOUP_DELETE_MUTATION_KEY = [
  'graphql-soup',
  'delete',
] as const;

export const GRAPHQL_SOUP_DELETE_RETENTION_MS = 60_000;
const REVALIDATION_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;
const RETAINED_DELETIONS_KEY = graphqlSoupKeys.retainedDeletions.queryKey;
type RetainedDeletionIds = Array<Accessor<readonly string[]>>;

export type GraphqlSoupDeletion = {
  ids: Accessor<readonly string[]>;
  /** Restore failed ids immediately and revalidate the confirmed deletions. */
  settle: (deletedIds: readonly string[]) => void;
  release: () => void;
};

/** Per-operation state outlives the mutation and its observers until revalidation. */
export function createGraphqlSoupDeletion(
  ids: readonly string[]
): GraphqlSoupDeletion {
  const [deletedIds, setDeletedIds] = createSignal(ids);
  let settled = false;
  let released = false;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(expiryTimer);
    clearTimeout(retryTimer);
    setDeletedIds([]);
    queryClient.setQueryData<RetainedDeletionIds>(
      RETAINED_DELETIONS_KEY,
      (retained) => retained?.filter((ids) => ids !== deletedIds)
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
          void revalidate(attempt + 1);
        },
        RETRY_DELAY_MS * 2 ** attempt
      );
    }
  };
  return {
    ids: deletedIds,
    release,
    settle: (successfulIds) => {
      if (settled || released) return;
      settled = true;
      setDeletedIds([...new Set(successfulIds)]);
      if (successfulIds.length === 0) {
        release();
        // Reconcile uncertain failures without retaining a failed deletion.
        if (ids.length > 0) void revalidate(0);
        return;
      }
      // A mutation observer can detach before the API finishes, starting its
      // GC clock early. Keep confirmed ids outside that mutation's lifetime.
      queryClient.setQueryData<RetainedDeletionIds>(
        RETAINED_DELETIONS_KEY,
        (retained) => [...(retained ?? []), deletedIds]
      );
      // Cleanup is independent of hung refresh promises and query lifetime.
      expiryTimer = setTimeout(release, GRAPHQL_SOUP_DELETE_RETENTION_MS);
      void revalidate(0);
    },
  };
}

/** Only GraphQL-enabled bulk deletes opt into the display overlay. */
export type GraphqlSoupDeleteContext = {
  graphqlDeletion?: GraphqlSoupDeletion;
};

/** Reflect pending and confirmed REST deletions in GraphQL views. Completed
 * mutations retain their own tombstones until strict revalidation or expiry.
 */
export function usePendingGraphqlSoupDeleteIds() {
  const retained = useQuery(
    () => ({
      queryKey: RETAINED_DELETIONS_KEY,
      queryFn: skipToken,
      initialData: [] as RetainedDeletionIds,
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
          ?.graphqlDeletion?.ids,
    }),
    () => queryClient
  );
  return createMemo<ReadonlySet<string>>(
    () =>
      new Set([
        ...deletions().flatMap((ids) => ids?.() ?? []),
        ...(retained.isSuccess ? retained.data.flatMap((ids) => ids()) : []),
      ])
  );
}

/** Preserve unaffected rows and array identity, including when no delete is pending. */
export function withoutPendingSoupEntities<T extends { id: string }>(
  entities: T[],
  deletedIds: ReadonlySet<string>
): T[] {
  if (
    deletedIds.size === 0 ||
    !entities.some((entity) => deletedIds.has(entity.id))
  )
    return entities;
  return entities.filter((entity) => !deletedIds.has(entity.id));
}

/** Applies only at the GraphQL display boundary, after local/server reconciliation. */
export function withoutPendingGraphqlSoupDeletes(
  data: SoupAstItemsData | undefined,
  deletedIds: ReadonlySet<string>
): SoupAstItemsData | undefined {
  if (!data || deletedIds.size === 0) return data;
  const entities = withoutPendingSoupEntities(data.entities, deletedIds);
  const groups = data.groups?.map((group) => {
    const itemIds = group.itemIds.filter((id) => !deletedIds.has(id));
    const removed = group.itemIds.length - itemIds.length;
    return removed === 0
      ? group
      : {
          ...group,
          itemIds,
          totalCount: Math.max(0, group.totalCount - removed),
        };
  });
  const itemsById = data.itemsById;
  const removedItemIds = itemsById
    ? Object.keys(itemsById).filter((id) => deletedIds.has(id))
    : [];
  if (
    entities === data.entities &&
    groups?.every((group, index) => group === data.groups?.[index]) !== false &&
    removedItemIds.length === 0
  ) {
    return data;
  }
  const remainingItems =
    removedItemIds.length > 0 ? { ...itemsById } : itemsById;
  if (remainingItems && removedItemIds.length > 0) {
    for (const id of removedItemIds) delete remainingItems[id];
  }
  return { ...data, entities, groups, itemsById: remainingItems };
}
