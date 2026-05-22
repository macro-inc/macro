import { QUERY_FILTERS_BASE } from '@app/component/next-soup/filters/query-filters';

import type { UnifiedSearchResponseItem } from '@service-search/generated/models';
import type {
  PostSoupRequest,
  SoupApiItem,
} from '@service-storage/generated/schemas';
import type { SoupPage } from '@service-storage/generated/schemas/soupPage';
import {
  type InfiniteData,
  partialMatchKey,
  type QueryKey,
} from '@tanstack/solid-query';
import { isAfter } from 'date-fns';
import { match } from 'ts-pattern';
import { queryClient } from '../../client';
import {
  computeGroupKeysForItem,
  extractGroupByFromKey,
  extractPerGroupKeyFromQueryKey,
} from '../grouped/api';
import type { GroupedSoupPage, GroupMeta } from '../grouped/types';
import type {
  SoupApiItemFilter,
  SoupAstItemsGroupedPage,
  SoupAstItemsPage,
} from '../items';
import { isGroupedSubqueryKey, soupKeys } from '../keys';
import {
  getNormalizationObjectKey,
  getSoupNormalizer,
  type NormalizerData,
} from './normalizer';
import type {
  SoupEntityPartial,
  SoupEntityTag,
  SoupTransaction,
} from './types';

/**
 * Optimistically update a single soup entity across all queries that
 * reference it. Returns a transaction whose `rollback()` restores affected
 * queries.
 *
 * After normy's field merge, reconciles group membership in every grouped
 * cache containing this entity. If the merged item's bucket changed (e.g.
 * status while grouped by status), it's moved between groups by mutating
 * `itemIds` arrays — the items pool itself stays untouched. Date and
 * non-categorical groupings fall back to invalidation.
 *
 * Partial shape:
 * - Channels: `{ tag: 'channel', data: { channel: { id, ...fields } }, frecency_score }`
 * - Everything else: `{ tag, data: { id, ...fields }, frecency_score }`
 */
export function optimisticUpdateSoupEntity<T extends SoupEntityTag>(
  partial: SoupEntityPartial<T>
): SoupTransaction {
  const normalizer = getSoupNormalizer();
  const normKey = getNormalizationObjectKey(partial);

  // Snapshot dependent caches for the field-merge rollback, plus all astItems
  // caches for the reconcile-pass rollback (moves may touch non-dependents).
  const dependentKeys = normKey
    ? normalizer.getDependentQueriesByIds([normKey])
    : [];
  const previousDependents = dependentKeys.map(
    (key: QueryKey) =>
      [
        key,
        queryClient.getQueryData<InfiniteData<SoupPage, unknown>>(key),
      ] as const,
  );
  const previousAllSoup = snapshotSoup();

  normalizer.setNormalizedData(partial as NormalizerData);

  if (normKey) {
    reconcileGroupMembership(normKey.slice('soup:'.length));
  }

  return {
    rollback: () => {
      for (const [key, data] of previousDependents) {
        queryClient.setQueryData(key, data);
      }
      restoreSnapshot(previousAllSoup);
    },
  };
}

/** Walk every grouped cache containing the entity; move it if its new group
 * keys differ from current membership. Pure `itemIds` mutations. */
function reconcileGroupMembership(entityId: string): void {
  reconcileParentAstItems(entityId);
  reconcilePerGroupCaches(entityId);
}

function reconcileParentAstItems(entityId: string): void {
  const parents = queryClient.getQueriesData<
    InfiniteData<SoupAstItemsPage, unknown>
  >({
    predicate: (q) =>
      partialMatchKey(q.queryKey, soupKeys.astItems._def) &&
      !isGroupedSubqueryKey(q.queryKey),
  });

  for (const [key, prev] of parents) {
    if (!prev?.pages?.length) continue;

    const firstPage = prev.pages[0];
    if (firstPage?.kind !== 'grouped') continue;
    if (!(entityId in firstPage.items)) continue;

    const item = firstPage.items[entityId];
    const newKeys = computeGroupKeysForItem(item, extractGroupByFromKey(key));
    if (newKeys === undefined) {
      queryClient.invalidateQueries({ queryKey: key });
      continue;
    }

    const oldKeys = firstPage.groups
      .filter((g) => g.itemIds.includes(entityId))
      .map((g) => g.key);
    if (sameKeys(oldKeys, newKeys)) continue;

    const moved = moveItemBetweenGroups(firstPage, entityId, newKeys);
    queryClient.setQueryData<InfiniteData<SoupAstItemsPage, unknown>>(key, {
      ...prev,
      pages: [moved, ...prev.pages.slice(1)],
    });
  }
}

function reconcilePerGroupCaches(entityId: string): void {
  const subs = queryClient.getQueriesData<
    InfiniteData<GroupedSoupPage, unknown>
  >({ predicate: (q) => isGroupedSubqueryKey(q.queryKey) });

  for (const [key, prev] of subs) {
    if (!prev?.pages?.length) continue;

    const myGroupKey = extractPerGroupKeyFromQueryKey(key);
    if (myGroupKey === undefined) continue;

    const canonical = getSoupEntityById(entityId);
    if (!canonical) continue;

    const newKeys = computeGroupKeysForItem(
      canonical,
      extractGroupByFromKey(key),
    );
    if (newKeys === undefined) {
      queryClient.invalidateQueries({ queryKey: key });
      continue;
    }

    const isHere = prev.pages.some((p) => entityId in p.items);
    const belongsHere = newKeys.includes(myGroupKey);
    if (isHere === belongsHere) continue;

    if (isHere) {
      queryClient.setQueryData<InfiniteData<GroupedSoupPage, unknown>>(key, {
        ...prev,
        pages: prev.pages.map((p) =>
          removeFromGroupedPage(p, new Set([entityId])),
        ),
      });
      continue;
    }

    queryClient.setQueryData<InfiniteData<GroupedSoupPage, unknown>>(key, {
      ...prev,
      pages: prev.pages.map((p, i) =>
        i === 0 ? addToGroupedPage(p, canonical, myGroupKey) : p,
      ),
    });
  }
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const k of b) if (!setA.has(k)) return false;
  return true;
}

/** Move an entity between groups by mutating `itemIds` arrays. The item is
 * prepended to each new group it joins, removed from each old group it left,
 * and totalCount is adjusted. The items pool is untouched. */
function moveItemBetweenGroups(
  page: SoupAstItemsGroupedPage,
  entityId: string,
  newKeys: string[],
): SoupAstItemsGroupedPage {
  const newSet = new Set(newKeys);

  const groups = page.groups.map((g) => {
    const wasIn = g.itemIds.includes(entityId);
    const goesIn = newSet.has(g.key);
    if (wasIn === goesIn) return g;

    if (goesIn) {
      return {
        ...g,
        itemIds: [entityId, ...g.itemIds],
        totalCount: g.totalCount + 1,
      };
    }
    return {
      ...g,
      itemIds: g.itemIds.filter((id) => id !== entityId),
      totalCount: Math.max(0, g.totalCount - 1),
    };
  });

  return { ...page, groups };
}

/** Read an entity from normy's normalized store by ID. Returns `undefined` if not cached. */
export function getSoupEntityById(entityId: string): SoupApiItem | undefined {
  return (getSoupNormalizer().getObjectById(`soup:${entityId}`) ?? undefined) as
    | SoupApiItem
    | undefined;
}

/**
 * Mark stale only the soup queries containing a specific entity.
 * Prefer this over `invalidateAllSoup` when you know the affected entity ID.
 */
export function invalidateSoupEntity(entityId: string): void {
  const normalizer = getSoupNormalizer();
  const keys = normalizer.getDependentQueriesByIds([`soup:${entityId}`]);
  for (const queryKey of keys) {
    queryClient.invalidateQueries({ queryKey });
  }
}

/** Mark every soup list query stale. Use `invalidateSoupEntity` when the entity ID is known. */
export function invalidateAllSoup(): void {
  queryClient.invalidateQueries({
    queryKey: soupKeys.items._def,
  });
  queryClient.invalidateQueries({
    queryKey: soupKeys.astItems._def,
  });
}

/** O(1) check whether an entity exists in normy's normalized store. */
export function hasSoupEntity(entityId: string): boolean {
  return getSoupNormalizer().getObjectById(`soup:${entityId}`) != null;
}

/** Extract the canonical entity ID from a SoupApiItem (handles channel's nested `data.channel.id` and callRecord's `data.callId`). */
export function getSoupItemId(item: SoupApiItem): string {
  switch (item.tag) {
    case 'channel':
      return item.data.channel.id;
    case 'call':
      return item.data.callId;
    default:
      return item.data.id;
  }
}

/** Add an item to a grouped page's normalized pool and prepend its id to the
 * target groups' `itemIds`. Untargeted groups are unchanged. */
function addToGroupedPage<P extends { items: Record<string, SoupApiItem>; groups: GroupMeta[] }>(
  page: P,
  item: SoupApiItem,
  targetKey: string,
): P {
  const id = getSoupItemId(item);
  const items = { ...page.items, [id]: item };
  const groups = page.groups.map((g) =>
    g.key === targetKey
      ? {
          ...g,
          itemIds: [id, ...g.itemIds.filter((x) => x !== id)],
          totalCount: g.totalCount + 1,
        }
      : g,
  );
  return { ...page, items, groups };
}

/** Remove a set of ids from a grouped page: drop them from the pool and
 * filter each group's `itemIds`, decrementing `totalCount` per group. */
function removeFromGroupedPage<P extends { items: Record<string, SoupApiItem>; groups: GroupMeta[] }>(
  page: P,
  ids: Set<string>,
): P {
  const items = { ...page.items };
  let touched = false;
  for (const id of ids) {
    if (id in items) {
      delete items[id];
      touched = true;
    }
  }

  const groups = page.groups.map((g) => {
    const itemIds = g.itemIds.filter((id) => !ids.has(id));
    if (itemIds.length === g.itemIds.length) return g;
    touched = true;
    const removed = g.itemIds.length - itemIds.length;
    return { ...g, itemIds, totalCount: Math.max(0, g.totalCount - removed) };
  });

  return touched ? { ...page, items, groups } : page;
}

/**
 * Insert a new entity into the first page of every active soup list query.
 * For non-grouped pages, prepends to the items array. For grouped pages,
 * derives the item's target group keys, adds it to the items pool, and
 * prepends its id to each matching group's `itemIds`. If the grouping can't
 * be derived client-side (date / non-categorical property), falls back to
 * invalidating grouped caches.
 */
export function insertSoupEntity(item: SoupApiItem): SoupTransaction {
  const previous = snapshotSoup();
  const id = getSoupItemId(item);
  let needGroupedInvalidation = false;

  // Legacy `items` queries (always flat).
  queryClient.setQueriesData<InfiniteData<SoupPage, unknown>>(
    {
      predicate: (query) => {
        if (!partialMatchKey(query.queryKey, soupKeys.items._def)) return false;
        const filter = query.meta?.itemFilter as SoupApiItemFilter | undefined;
        return filter ? filter(item) : true;
      },
    },
    (prev) => {
      if (!prev?.pages) return prev;
      return {
        ...prev,
        pages: prev.pages.map((p, i) =>
          i === 0 ? { ...p, items: [item, ...p.items] } : p,
        ),
      };
    },
  );

  // Parent astItems queries (grouped or flat).
  const parents = queryClient.getQueriesData<
    InfiniteData<SoupAstItemsPage, unknown>
  >({
    predicate: (q) =>
      partialMatchKey(q.queryKey, soupKeys.astItems._def) &&
      !isGroupedSubqueryKey(q.queryKey),
  });
  for (const [key, prev] of parents) {
    if (!prev?.pages?.length) continue;
    const firstPage = prev.pages[0];

    if (firstPage.kind === 'flat') {
      queryClient.setQueryData<InfiniteData<SoupAstItemsPage, unknown>>(key, {
        ...prev,
        pages: prev.pages.map((p, i) =>
          i === 0 && p.kind === 'flat'
            ? { ...p, items: [item, ...p.items] }
            : p,
        ),
      });
      continue;
    }

    const newKeys = computeGroupKeysForItem(item, extractGroupByFromKey(key));
    if (newKeys === undefined || newKeys.length === 0) {
      needGroupedInvalidation = true;
      continue;
    }

    let nextPage: SoupAstItemsGroupedPage = firstPage;
    for (const targetKey of newKeys) {
      if (!nextPage.groups.find((g) => g.key === targetKey)) {
        needGroupedInvalidation = true;
        continue;
      }
      nextPage = addToGroupedPage(nextPage, item, targetKey);
    }

    queryClient.setQueryData<InfiniteData<SoupAstItemsPage, unknown>>(key, {
      ...prev,
      pages: [nextPage, ...prev.pages.slice(1)],
    });
  }

  // Per-group caches: add to those whose group is in the item's keys.
  const subs = queryClient.getQueriesData<
    InfiniteData<GroupedSoupPage, unknown>
  >({ predicate: (q) => isGroupedSubqueryKey(q.queryKey) });
  for (const [key, prev] of subs) {
    if (!prev?.pages?.length) continue;
    const myGroupKey = extractPerGroupKeyFromQueryKey(key);
    if (myGroupKey === undefined) continue;

    const newKeys = computeGroupKeysForItem(item, extractGroupByFromKey(key));
    if (newKeys === undefined) {
      queryClient.invalidateQueries({ queryKey: key });
      continue;
    }
    if (!newKeys.includes(myGroupKey)) continue;
    if (prev.pages.some((p) => id in p.items)) continue; // already present

    queryClient.setQueryData<InfiniteData<GroupedSoupPage, unknown>>(key, {
      ...prev,
      pages: prev.pages.map((p, i) =>
        i === 0 ? addToGroupedPage(p, item, myGroupKey) : p,
      ),
    });
  }

  if (needGroupedInvalidation) {
    queryClient.invalidateQueries({
      predicate: (q) => isGroupedSubqueryKey(q.queryKey),
    });
  }

  return { rollback: () => restoreSnapshot(previous) };
}

/**
 * Optimistically remove entities from all soup list queries.
 * For grouped pages, removes from the items pool and filters each group's
 * `itemIds`, decrementing `totalCount` per affected group.
 */
export function removeSoupEntities(entityIds: Set<string>): SoupTransaction {
  queryClient.cancelQueries({ queryKey: soupKeys.items._def });
  queryClient.cancelQueries({ queryKey: soupKeys.astItems._def });

  const previous = snapshotSoup();

  // Legacy `items` queries.
  queryClient.setQueriesData<InfiniteData<SoupPage, unknown>>(
    {
      predicate: (q) => partialMatchKey(q.queryKey, soupKeys.items._def),
    },
    (prev) => {
      if (!prev?.pages) return prev;
      return {
        ...prev,
        pages: prev.pages.map((page) => {
          const items = page.items.filter(
            (item) => !entityIds.has(getSoupItemId(item)),
          );
          if (items.length === page.items.length) return page;
          return { ...page, items };
        }),
      };
    },
  );

  // Parent astItems queries.
  queryClient.setQueriesData<InfiniteData<SoupAstItemsPage, unknown>>(
    {
      predicate: (q) =>
        partialMatchKey(q.queryKey, soupKeys.astItems._def) &&
        !isGroupedSubqueryKey(q.queryKey),
    },
    (prev) => {
      if (!prev?.pages) return prev;
      return {
        ...prev,
        pages: prev.pages.map((page) => {
          if (page.kind === 'grouped') {
            return removeFromGroupedPage(page, entityIds);
          }
          const items = page.items.filter(
            (item) => !entityIds.has(getSoupItemId(item)),
          );
          if (items.length === page.items.length) return page;
          return { ...page, items };
        }),
      };
    },
  );

  // Per-group caches.
  queryClient.setQueriesData<InfiniteData<GroupedSoupPage, unknown>>(
    { predicate: (q) => isGroupedSubqueryKey(q.queryKey) },
    (prev) => {
      if (!prev?.pages) return prev;
      return {
        ...prev,
        pages: prev.pages.map((page) => removeFromGroupedPage(page, entityIds)),
      };
    },
  );

  return { rollback: () => restoreSnapshot(previous) };
}

/**
 * Optimistically remove entities from all search result queries.
 * Same cancel-snapshot-mutate pattern as `removeSoupEntities` but targets search queries.
 */
export function removeSearchEntities(entityIds: Set<string>): SoupTransaction {
  queryClient.cancelQueries({ queryKey: soupKeys.search._def });

  const previous = queryClient.getQueriesData<
    InfiniteData<{ results: UnifiedSearchResponseItem[] }, unknown>
  >({
    queryKey: soupKeys.search._def,
  });

  queryClient.setQueriesData<
    InfiniteData<{ results: UnifiedSearchResponseItem[] }, unknown>
  >({ queryKey: soupKeys.search._def }, (prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      pages: prev.pages.map((page) => {
        const results = page.results.filter(
          (result) => !entityIds.has(getSearchResultId(result))
        );
        return results.length === page.results.length
          ? page
          : { ...page, results };
      }),
    };
  });

  return {
    rollback: () => {
      for (const [key, data] of previous) {
        queryClient.setQueryData(key, data);
      }
    },
  };
}

/**
 * Fetch a single entity from the server and merge it into the cache.
 * If the entity is already cached, updates it via normy (deep-merge).
 * If it's new, prepends it to the first page of every active soup list query.
 */
export async function refetchSoupEntity(
  entityId: string,
  entityType: SoupEntityTag,
  options?: { includeRoot?: boolean }
): Promise<void> {
  const { storageServiceClient } = await import('@service-storage/client');

  const filter = buildSingleEntityFilter(entityType, entityId, options);

  const result = await storageServiceClient.getSoupItems({
    params: {},
    body: filter,
  });

  if (result.isErr()) {
    console.error(
      '[normalized-cache] operations: failed to fetch individual soup item',
      result
    );
    return;
  }

  const page = result.value;
  if (!page.items.length) return;

  for (const item of page.items) {
    const itemId = getSoupItemId(item);
    if (hasSoupEntity(itemId)) {
      optimisticUpdateSoupEntity(item);
    } else {
      insertSoupEntity(item);
    }
  }
}

/** @private */
export function buildSingleEntityFilter(
  entityType: SoupEntityTag,
  entityId: string,
  options?: { includeRoot?: boolean }
): PostSoupRequest {
  const base: PostSoupRequest = {
    ...QUERY_FILTERS_BASE,
    limit: 1,
  };
  return match(entityType)
    .with('document', () => ({
      ...base,
      document_filters: { document_ids: [entityId] },
    }))
    .with('chat', () => ({ ...base, chat_filters: { chat_ids: [entityId] } }))
    .with('channel', () => ({
      ...base,
      channel_filters: { channel_ids: [entityId] },
    }))
    .with('project', () => ({
      ...base,
      project_filters: {
        project_ids: [entityId],
        include_root: options?.includeRoot ?? false,
      },
    }))
    .with('emailThread', () => ({
      ...base,
      email_filters: { email_thread_ids: [entityId] },
    }))
    .with('call', () => ({
      ...base,
      call_filters: { call_ids: [entityId] },
    }))
    .exhaustive();
}

/**
 * Optimistically update the viewedAt timestamp for a soup item.
 * Updates the item across all soup queries if it exists.
 */
export function optimisticUpdateSoupItemViewedAt(itemId: string) {
  const now = new Date().toISOString();

  // Lazy import to break circular dependency
  import('../recently-viewed').then(({ updateRecentlyViewedItem }) => {
    updateRecentlyViewedItem(itemId, now);
  });

  const current = getSoupEntityById(itemId);
  if (!current) return;

  if (current.tag === 'channel') {
    optimisticUpdateSoupEntity({
      tag: 'channel',
      data: { channel: { id: itemId }, viewed_at: now },
      frecency_score: current.frecency_score,
    });
  } else if (current.tag === 'call') {
    // Call records don't have viewedAt — skip.
    return;
  } else {
    optimisticUpdateSoupEntity({
      tag: current.tag,
      data: { id: itemId, viewedAt: now },
      frecency_score: current.frecency_score,
    });
  }
}

/**
 * Optimistically update the updatedAt/updated_at timestamp for a soup item.
 * Updates the item across all soup queries if it exists and matches the expected tag.
 */
export function optimisticUpdateSoupItemUpdatedAt(
  itemId: string,
  tag: SoupEntityTag,
  updatedAt: string
) {
  const current = getSoupEntityById(itemId);
  if (!current || current.tag !== tag) return;

  if (current.tag === 'channel') {
    if (
      !shouldUpdateOptimisticTimestamp(
        current.data.channel.updated_at,
        updatedAt
      )
    )
      return;

    optimisticUpdateSoupEntity({
      tag: 'channel',
      data: { channel: { id: itemId, updated_at: updatedAt } },
      frecency_score: current.frecency_score,
    });
  } else if (current.tag === 'call') {
    // Call records use endedAt/startedAt, not updatedAt — skip optimistic timestamp updates.
    return;
  } else {
    if (!shouldUpdateOptimisticTimestamp(current.data.updatedAt, updatedAt))
      return;

    optimisticUpdateSoupEntity({
      tag: current.tag,
      data: { id: itemId, updatedAt },
      frecency_score: current.frecency_score,
    });
  }
}

/** @private */
function shouldUpdateOptimisticTimestamp(
  currentUpdatedAt: string | undefined,
  incomingUpdatedAt: string
): boolean {
  return currentUpdatedAt
    ? isAfter(Date.parse(incomingUpdatedAt), Date.parse(currentUpdatedAt))
    : true;
}

/** @private */
function getSearchResultId(result: UnifiedSearchResponseItem): string {
  return match(result)
    .with({ type: 'document' }, (r) => r.document_id)
    .with({ type: 'chat' }, (r) => r.chat_id)
    .with({ type: 'channel' }, (r) => r.channel_id)
    .with({ type: 'email' }, (r) => r.thread_id)
    .with({ type: 'project' }, (r) => r.id)
    .with({ type: 'call' }, (r) => r.call_id)
    .exhaustive();
}

/** @private Captures every soup-list-shaped query (legacy items, parent
 * astItems, per-group caches) for full-range rollback. */
function snapshotSoup(): [QueryKey, unknown][] {
  return [
    ...queryClient.getQueriesData<unknown>({ queryKey: soupKeys.items._def }),
    ...queryClient.getQueriesData<unknown>({ queryKey: soupKeys.astItems._def }),
  ];
}

/** @private */
function restoreSnapshot(snapshot: [QueryKey, unknown][]): void {
  for (const [key, data] of snapshot) {
    queryClient.setQueryData(key, data);
  }
}
