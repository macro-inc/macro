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
} from '../grouped/api';
import type { GroupMeta } from '../grouped/types';
import type {
  SoupApiItemFilter,
  SoupAstItemsGroupedPage,
  SoupAstItemsPage,
} from '../items';
import { soupKeys } from '../keys';
import {
  getNormalizationObjectKey,
  getSoupNormalizer,
  type NormalizerData,
  soupNormKey,
  stripSoupNormPrefix,
} from './normalizer';
import type {
  SoupEntityPartial,
  SoupEntityTag,
  SoupTransaction,
} from './types';

/**
 * Optimistically update a single soup entity across all queries that
 * reference it. After normy's field merge, reconciles group membership in
 * every grouped cache containing this entity (`itemIds`-only mutations;
 * the items pool itself isn't moved between groups). Date and
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
    reconcileGroupMembership(stripSoupNormPrefix(normKey));
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

function reconcileGroupMembership(entityId: string): void {
  const entity = getSoupEntityById(entityId);
  if (!entity) return;

  const caches = queryClient.getQueriesData<
    InfiniteData<{ pages: unknown[] }, unknown> | undefined
  >({ queryKey: soupKeys.astItems._def });

  for (const [key, prev] of caches) {
    if (!prev || !Array.isArray(prev.pages) || prev.pages.length === 0) continue;

    const newKeys = computeGroupKeysForItem(
      entity,
      extractGroupByFromKey(key),
    );
    if (newKeys === undefined) {
      queryClient.invalidateQueries({ queryKey: key });
      continue;
    }

    let anyChanged = false;
    const pages = prev.pages.map((page) => {
      if (!isGroupedPage(page)) return page;
      const next = reconcileGroupedPage(page, entityId, newKeys, entity);
      if (next !== page) anyChanged = true;
      return next;
    });
    if (!anyChanged) continue;

    queryClient.setQueryData(key, { ...prev, pages });
  }
}

/** Runtime guard for the normalized grouped page shape — matches both the
 * parent's `kind: 'grouped'` page and per-group `GroupedSoupPage`. */
function isGroupedPage(
  page: unknown,
): page is { items: Record<string, SoupApiItem>; groups: GroupMeta[] } {
  if (!page || typeof page !== 'object') return false;
  const p = page as Record<string, unknown>;
  if (!Array.isArray(p.groups) || p.groups.length === 0) return false;
  return (
    p.items !== null &&
    typeof p.items === 'object' &&
    !Array.isArray(p.items)
  );
}

/** Add/remove the entity in each group based on `newKeys`, then drop it
 * from the items pool if no group in the page references it anymore.
 * Returns the same page reference when nothing changed. */
function reconcileGroupedPage<
  P extends { items: Record<string, SoupApiItem>; groups: GroupMeta[] },
>(page: P, entityId: string, newKeys: readonly string[], entity: SoupApiItem): P {
  const newKeySet = new Set(newKeys);
  const items = { ...page.items };
  let touched = false;

  const groups = page.groups.map((g) => {
    const inItemIds = g.itemIds.includes(entityId);
    const inNewKeys = newKeySet.has(g.key);
    if (inItemIds === inNewKeys) return g;
    touched = true;

    if (inNewKeys) {
      items[entityId] = entity;
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

  if (!touched) return page;

  if (!groups.some((g) => g.itemIds.includes(entityId))) {
    delete items[entityId];
  }

  return { ...page, items, groups };
}

export function getSoupEntityById(entityId: string): SoupApiItem | undefined {
  return (getSoupNormalizer().getObjectById(soupNormKey(entityId)) ?? undefined) as
    | SoupApiItem
    | undefined;
}

/**
 * Mark stale only the soup queries containing a specific entity.
 * Prefer this over `invalidateAllSoup` when you know the affected entity ID.
 */
export function invalidateSoupEntity(entityId: string): void {
  const normalizer = getSoupNormalizer();
  const keys = normalizer.getDependentQueriesByIds([soupNormKey(entityId)]);
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

export function hasSoupEntity(entityId: string): boolean {
  return getSoupNormalizer().getObjectById(soupNormKey(entityId)) != null;
}

/** Channels nest the id under `data.channel.id`; call records under `data.callId`. */
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

function addToGroupedPage<P extends { items: Record<string, SoupApiItem>; groups: GroupMeta[] }>(
  page: P,
  item: SoupApiItem,
  targetKey: string,
): P {
  const id = getSoupItemId(item);
  const items = { ...page.items, [id]: item };
  const groups = page.groups.map((g) => {
    if (g.key !== targetKey) return g;
    const alreadyPresent = g.itemIds.includes(id);
    return {
      ...g,
      itemIds: alreadyPresent ? [id, ...g.itemIds.filter((x) => x !== id)] : [id, ...g.itemIds],
      totalCount: alreadyPresent ? g.totalCount : g.totalCount + 1,
    };
  });
  return { ...page, items, groups };
}

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
 * Grouped pages: derive the item's target groups via `computeGroupKeysForItem`
 * and splice into each. Date / non-categorical groupings invalidate.
 */
export function insertSoupEntity(item: SoupApiItem): SoupTransaction {
  const previous = snapshotSoup();
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

  const parents = queryClient.getQueriesData<
    InfiniteData<SoupAstItemsPage, unknown>
  >({ queryKey: soupKeys.astItems._def });
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
      queryClient.invalidateQueries({ queryKey: key });
      continue;
    }

    let nextPage: SoupAstItemsGroupedPage = firstPage;
    let needsInvalidation = false;
    for (const targetKey of newKeys) {
      if (!nextPage.groups.find((g) => g.key === targetKey)) {
        needsInvalidation = true;
        continue;
      }
      nextPage = addToGroupedPage(nextPage, item, targetKey);
    }

    if (needsInvalidation) {
      queryClient.invalidateQueries({ queryKey: key });
      continue;
    }

    queryClient.setQueryData<InfiniteData<SoupAstItemsPage, unknown>>(key, {
      ...prev,
      pages: [nextPage, ...prev.pages.slice(1)],
    });
  }

  return { rollback: () => restoreSnapshot(previous) };
}

export function removeSoupEntities(entityIds: Set<string>): SoupTransaction {
  queryClient.cancelQueries({ queryKey: soupKeys.items._def });
  queryClient.cancelQueries({ queryKey: soupKeys.astItems._def });

  const previous = snapshotSoup();

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

  queryClient.setQueriesData<InfiniteData<SoupAstItemsPage, unknown>>(
    { queryKey: soupKeys.astItems._def },
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

  return { rollback: () => restoreSnapshot(previous) };
}

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
