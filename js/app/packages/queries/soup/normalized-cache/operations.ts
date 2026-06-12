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
import type { SoupApiItemFilter, SoupAstItemsPage } from '../items';
import { soupKeys } from '../keys';
import {
  insertGroupedPage,
  insertGroupQueries,
  removeGroupedPage,
  removeGroupQueries,
  syncGroupedParents,
  syncGroupQueries,
} from './grouped-operations';
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
import { getSoupQueryMeta } from './utils';

type SoupItemsInfiniteData = InfiniteData<SoupPage, unknown>;
type SoupAstItemsInfiniteData = InfiniteData<SoupAstItemsPage, unknown>;
type SoupSearchInfiniteData = InfiniteData<
  { results: UnifiedSearchResponseItem[] },
  unknown
>;

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
  queryClient.cancelQueries({ queryKey: soupKeys.items._def });
  queryClient.cancelQueries({ queryKey: soupKeys.astItems._def });

  const normalizer = getSoupNormalizer();
  const normKey = getNormalizationObjectKey(partial);

  const dependentKeys = normKey
    ? normalizer.getDependentQueriesByIds([normKey])
    : [];
  const previousDependents = dependentKeys.map(
    (key: QueryKey) =>
      [key, queryClient.getQueryData<SoupItemsInfiniteData>(key)] as const
  );
  const previousAllSoup = snapshotSoup();

  normalizer.setNormalizedData(partial as NormalizerData);

  if (normKey) {
    const entityId = stripSoupNormPrefix(normKey);
    const entity = getSoupEntityById(entityId);
    if (entity) {
      syncGroupedParents(entityId, entity);
      syncGroupQueries(entityId, entity);
    }
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

export function getSoupEntityById(entityId: string): SoupApiItem | undefined {
  return (getSoupNormalizer().getObjectById(soupNormKey(entityId)) ??
    undefined) as SoupApiItem | undefined;
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

/**
 * Insert a new entity into the first page of every active soup list query.
 * Grouped pages: derive the item's target groups via `computeGroupKeysForItem`
 * and upsert into each resolvable group. Date / unresolved labels invalidate.
 */
export function insertSoupEntity(item: SoupApiItem): SoupTransaction {
  queryClient.cancelQueries({ queryKey: soupKeys.items._def });
  queryClient.cancelQueries({ queryKey: soupKeys.astItems._def });

  const previous = snapshotSoup();
  queryClient.setQueriesData<SoupItemsInfiniteData>(
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
          i === 0 ? { ...p, items: [item, ...p.items] } : p
        ),
      };
    }
  );

  const parents = queryClient.getQueriesData<SoupAstItemsInfiniteData>({
    queryKey: soupKeys.astItems._def,
  });

  for (const [key, prev] of parents) {
    if (!prev?.pages?.length) continue;

    const meta = getSoupQueryMeta(
      queryClient.getQueryCache().find({ queryKey: key })?.meta
    );
    const filter = meta.itemFilter;
    if (filter && !filter(item)) continue;

    const firstPage = prev.pages[0];

    if (firstPage.kind === 'flat') {
      queryClient.setQueryData<SoupAstItemsInfiniteData>(key, {
        ...prev,
        pages: prev.pages.map((p, i) =>
          i === 0 && p.kind === 'flat' ? { ...p, items: [item, ...p.items] } : p
        ),
      });

      continue;
    }

    const nextPage = insertGroupedPage(
      firstPage,
      item,
      getSoupItemId(item),
      meta.groupBy
    );

    if (!nextPage) {
      queryClient.invalidateQueries({ queryKey: key });
      continue;
    }

    queryClient.setQueryData<SoupAstItemsInfiniteData>(key, {
      ...prev,
      pages: [nextPage, ...prev.pages.slice(1)],
    });
  }

  insertGroupQueries(item, getSoupItemId(item));

  return { rollback: () => restoreSnapshot(previous) };
}

export function removeSoupEntities(entityIds: Set<string>): SoupTransaction {
  queryClient.cancelQueries({ queryKey: soupKeys.items._def });
  queryClient.cancelQueries({ queryKey: soupKeys.astItems._def });

  const previous = snapshotSoup();

  queryClient.setQueriesData<SoupItemsInfiniteData>(
    {
      predicate: (q) => partialMatchKey(q.queryKey, soupKeys.items._def),
    },
    (prev) => {
      if (!prev?.pages) return prev;
      return {
        ...prev,
        pages: prev.pages.map((page) => {
          const items = page.items.filter(
            (item) => !entityIds.has(getSoupItemId(item))
          );
          if (items.length === page.items.length) return page;
          return { ...page, items };
        }),
      };
    }
  );

  queryClient.setQueriesData<SoupAstItemsInfiniteData>(
    { queryKey: soupKeys.astItems._def },
    (prev) => {
      if (!prev?.pages?.length) return prev;

      const firstPage = prev.pages[0];

      if (firstPage.kind === 'flat') {
        // Flat AST queries can have multiple pages; remove the ids from every
        // page and preserve page references that were not affected.
        let changed = false;
        const pages = prev.pages.map((page) => {
          if (page.kind !== 'flat') return page;

          const items = page.items.filter(
            (item) => !entityIds.has(getSoupItemId(item))
          );

          if (items.length === page.items.length) return page;

          changed = true;
          return { ...page, items };
        });

        return changed ? { ...prev, pages } : prev;
      }

      // Grouped AST queries only use the first parent page. Group membership is
      // fully represented there by `groups[].itemIds`, so update that page once.
      const nextPage = removeGroupedPage(firstPage, entityIds);

      return nextPage === firstPage
        ? prev
        : { ...prev, pages: [nextPage, ...prev.pages.slice(1)] };
    }
  );

  removeGroupQueries(entityIds);

  return { rollback: () => restoreSnapshot(previous) };
}

export function removeSearchEntities(entityIds: Set<string>): SoupTransaction {
  queryClient.cancelQueries({ queryKey: soupKeys.search._def });

  const previous = queryClient.getQueriesData<SoupSearchInfiniteData>({
    queryKey: soupKeys.search._def,
  });

  queryClient.setQueriesData<SoupSearchInfiniteData>(
    { queryKey: soupKeys.search._def },
    (prev) => {
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
    }
  );

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
      invalidateAllSoup();
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
    .with('crmCompany', () => ({
      ...base,
      crm_company_filters: { company_ids: [entityId] },
    }))
    .with('foreignEntity', () => ({
      ...base,
      foreign_entity_filters: { ids: [entityId] },
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
  } else if (current.tag === 'call' || current.tag === 'foreignEntity') {
    // Call records and foreign entities don't have viewedAt — skip.
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
    .with({ type: 'company' }, (r) => r.id)
    .exhaustive();
}

/** @private Captures every soup-list-shaped query (legacy items, parent
 * astItems, per-group caches) for full-range rollback. */
function snapshotSoup(): [QueryKey, unknown][] {
  return [
    ...queryClient.getQueriesData<unknown>({ queryKey: soupKeys.items._def }),
    ...queryClient.getQueriesData<unknown>({
      queryKey: soupKeys.astItems._def,
    }),
    ...queryClient.getQueriesData<unknown>({
      queryKey: soupKeys.groupedGroup._def,
    }),
  ];
}

/** @private */
function restoreSnapshot(snapshot: [QueryKey, unknown][]): void {
  for (const [key, data] of snapshot) {
    queryClient.setQueryData(key, data);
  }
}
