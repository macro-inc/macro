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
  type ResolvedGroupMeta,
  resolveGroupMetaForKey,
} from '../grouped/api';
import type { GroupByField, GroupMeta } from '../grouped/types';
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

type SoupItemsInfiniteData = InfiniteData<SoupPage, unknown>;
type SoupAstItemsInfiniteData = InfiniteData<SoupAstItemsPage, unknown>;
type GroupedGroupPage = {
  items: Record<string, SoupApiItem>;
  group: GroupMeta;
};
type GroupedGroupInfiniteData = InfiniteData<GroupedGroupPage, unknown>;
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
    reconcileGroupedCachesForEntity(entityId);
    reconcileGroupedGroupQueriesForEntity(entityId);
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

function reconcileGroupedCachesForEntity(entityId: string): void {
  const entity = getSoupEntityById(entityId);
  if (!entity) return;

  const caches = queryClient.getQueriesData<
    InfiniteData<{ pages: unknown[] }, unknown> | undefined
  >({ queryKey: soupKeys.astItems._def });

  for (const [key, prev] of caches) {
    if (!prev || !Array.isArray(prev.pages) || prev.pages.length === 0) {
      continue;
    }

    const groupBy = extractGroupByFromKey(key);

    if (!groupBy) continue;

    const nextGroupKeys = computeGroupKeysForItem(entity, groupBy);

    if (nextGroupKeys === undefined) {
      continue;
    }

    let changed = false;
    let needsInvalidation = false;

    const pages = prev.pages.map((page) => {
      if (!isGroupedPage(page)) return page;

      const next = reconcileGroupedMembership(
        page,
        entityId,
        nextGroupKeys,
        entity,
        groupBy
      );

      if (!next) {
        needsInvalidation = true;
        return page;
      }

      if (next !== page) changed = true;

      return next;
    });

    if (needsInvalidation) {
      continue;
    }

    if (!changed) continue;

    queryClient.setQueryData(key, { ...prev, pages });
  }
}

function reconcileGroupedGroupQueriesForEntity(entityId: string): void {
  const entity = getSoupEntityById(entityId);
  if (!entity) return;

  const caches = queryClient.getQueriesData<GroupedGroupInfiniteData>({
    queryKey: soupKeys.groupedGroup._def,
  });

  for (const [key, prev] of caches) {
    if (!prev?.pages?.length) continue;

    const groupBy = extractGroupByFromKey(key);
    const groupKey = extractGroupedGroupKeyFromKey(key);
    if (!groupBy || groupKey == null) continue;

    const nextGroupKeys = computeGroupKeysForItem(entity, groupBy);
    if (nextGroupKeys === undefined) continue;

    const filter = getSoupItemFilterForQueryKey(key);
    const shouldHave =
      nextGroupKeys.includes(groupKey) && (filter ? filter(entity) : true);
    let changed = false;

    const pages = prev.pages.map((page, index) => {
      const hasEntity = page.group.itemIds.includes(entityId);

      if (shouldHave && index === 0 && !hasEntity) {
        changed = true;
        return {
          ...page,
          items: { ...page.items, [entityId]: entity },
          group: prependEntityIdToGroup(page.group, entityId),
        };
      }

      if (!shouldHave && hasEntity) {
        changed = true;
        const { [entityId]: _removed, ...items } = page.items;
        return {
          ...page,
          items,
          group: removeEntityIdFromGroup(page.group, entityId),
        };
      }

      return page;
    });

    if (changed) {
      queryClient.setQueryData(key, { ...prev, pages });
    }
  }
}

function extractGroupedGroupKeyFromKey(key: QueryKey): string | undefined {
  const markerIndex = key.findIndex((part) => part === 'group');
  const groupKey = markerIndex >= 0 ? key[markerIndex + 1] : undefined;
  return typeof groupKey === 'string' ? groupKey : undefined;
}

/** Runtime guard for the normalized grouped parent page shape. */
function isGroupedPage(page: unknown): page is SoupAstItemsGroupedPage {
  if (!page || typeof page !== 'object') return false;
  const p = page as Record<string, unknown>;
  return (
    p.kind === 'grouped' &&
    Array.isArray(p.groups) &&
    p.items !== null &&
    typeof p.items === 'object' &&
    !Array.isArray(p.items)
  );
}

/** Reconcile group membership for an existing entity. Returns `undefined`
 * when a required new group cannot be created client-side and the caller should
 * invalidate instead of applying a partial optimistic move. */
function reconcileGroupedMembership(
  page: SoupAstItemsGroupedPage,
  entityId: string,
  nextGroupKeys: readonly string[],
  entity: SoupApiItem,
  groupBy: GroupByField | undefined
): SoupAstItemsGroupedPage | undefined {
  const nextKeySet = new Set(nextGroupKeys);
  const existingKeys = new Set(page.groups.map((g) => g.key));

  let changed = false;

  const groups: GroupMeta[] = [];

  for (const key of nextKeySet) {
    if (existingKeys.has(key)) continue;

    const meta = resolveGroupMetaForKey(groupBy, key, entity);

    if (!meta) return;

    changed = true;
    groups.push(createOptimisticGroup(meta, entityId));
  }

  for (const group of page.groups) {
    const hasEntity = group.itemIds.includes(entityId);
    const shouldInsert = nextKeySet.has(group.key);

    // No-op
    if (hasEntity === shouldInsert) {
      groups.push(group);
      continue;
    }

    changed = true;

    // Remove or add entity from group
    groups.push(
      shouldInsert
        ? prependEntityIdToGroup(group, entityId)
        : removeEntityIdFromGroup(group, entityId)
    );
  }

  if (!changed) return page;

  const newGroupsExist = nextKeySet.size > 0;
  const nextItems: Record<string, SoupApiItem> = {};

  for (const [id, item] of Object.entries(page.items)) {
    if (id !== entityId || newGroupsExist) {
      nextItems[id] = item;
    }
  }

  if (newGroupsExist) nextItems[entityId] = entity;

  return { ...page, items: nextItems, groups };
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

function createOptimisticGroup(
  meta: ResolvedGroupMeta,
  entityId: string
): GroupMeta {
  return {
    ...meta,
    totalCount: 1,
    itemIds: [entityId],
    nextCursor: null,
  };
}

function prependEntityIdToGroup(group: GroupMeta, entityId: string): GroupMeta {
  const existing = group.itemIds.includes(entityId);

  return {
    ...group,
    itemIds: existing
      ? [entityId, ...group.itemIds.filter((id) => id !== entityId)]
      : [entityId, ...group.itemIds],
    totalCount: existing ? group.totalCount : group.totalCount + 1,
  };
}

function removeEntityIdFromGroup(
  group: GroupMeta,
  entityId: string
): GroupMeta {
  if (!group.itemIds.includes(entityId)) return group;

  return {
    ...group,
    itemIds: group.itemIds.filter((id) => id !== entityId),
    totalCount: Math.max(0, group.totalCount - 1),
  };
}

function insertIntoGroupedPage(
  page: SoupAstItemsGroupedPage,
  item: SoupApiItem,
  groupBy: GroupByField | undefined
): SoupAstItemsGroupedPage | undefined {
  const newKeys = computeGroupKeysForItem(item, groupBy);
  if (newKeys === undefined || newKeys.length === 0) return;

  const itemId = getSoupItemId(item);
  const targetKeys = new Set(newKeys);
  const existingKeys = new Set(page.groups.map((g) => g.key));
  const groups: GroupMeta[] = [];

  for (const targetKey of targetKeys) {
    if (existingKeys.has(targetKey)) continue;

    const meta = resolveGroupMetaForKey(groupBy, targetKey, item);
    if (!meta) return;

    groups.push(createOptimisticGroup(meta, itemId));
  }

  for (const group of page.groups) {
    groups.push(
      targetKeys.has(group.key) ? prependEntityIdToGroup(group, itemId) : group
    );
  }

  return {
    ...page,
    items: { ...page.items, [itemId]: item },
    groups,
  };
}

function insertIntoGroupedGroupQueries(item: SoupApiItem): void {
  const itemId = getSoupItemId(item);
  const caches = queryClient.getQueriesData<GroupedGroupInfiniteData>({
    queryKey: soupKeys.groupedGroup._def,
  });

  for (const [key, prev] of caches) {
    if (!prev?.pages?.length) continue;

    const filter = getSoupItemFilterForQueryKey(key);
    if (filter && !filter(item)) continue;

    const groupBy = extractGroupByFromKey(key);
    const groupKey = extractGroupedGroupKeyFromKey(key);
    if (!groupBy || groupKey == null) continue;

    const targetKeys = computeGroupKeysForItem(item, groupBy);
    if (!targetKeys?.includes(groupKey)) continue;

    const firstPage = prev.pages[0];
    if (firstPage.group.itemIds.includes(itemId)) continue;

    queryClient.setQueryData<GroupedGroupInfiniteData>(key, {
      ...prev,
      pages: [
        {
          ...firstPage,
          items: { ...firstPage.items, [itemId]: item },
          group: prependEntityIdToGroup(firstPage.group, itemId),
        },
        ...prev.pages.slice(1),
      ],
    });
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

    const filter = getSoupItemFilterForQueryKey(key);
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

    const nextPage = insertIntoGroupedPage(
      firstPage,
      item,
      extractGroupByFromKey(key)
    );

    if (!nextPage) {
      continue;
    }

    queryClient.setQueryData<SoupAstItemsInfiniteData>(key, {
      ...prev,
      pages: [nextPage, ...prev.pages.slice(1)],
    });
  }

  insertIntoGroupedGroupQueries(item);

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
      // fully represented there by `groups[].itemIds`, so update that page once
      // instead of mapping grouped logic across every page.
      const groups: GroupMeta[] = [];
      let changed = false;

      for (const group of firstPage.groups) {
        const itemIds = group.itemIds.filter((id) => !entityIds.has(id));
        const removed = group.itemIds.length - itemIds.length;

        if (removed === 0) {
          groups.push(group);
          continue;
        }

        changed = true;

        groups.push({
          ...group,
          itemIds,
          totalCount: Math.max(0, group.totalCount - removed),
        });
      }

      const items: Record<string, SoupApiItem> = {};
      for (const [id, item] of Object.entries(firstPage.items)) {
        if (entityIds.has(id)) {
          changed = true;
          continue;
        }

        items[id] = item;
      }

      return changed
        ? {
            ...prev,
            pages: [{ ...firstPage, items, groups }, ...prev.pages.slice(1)],
          }
        : prev;
    }
  );

  removeFromGroupedGroupQueries(entityIds);

  return { rollback: () => restoreSnapshot(previous) };
}

function removeFromGroupedGroupQueries(entityIds: Set<string>): void {
  queryClient.setQueriesData<GroupedGroupInfiniteData>(
    { queryKey: soupKeys.groupedGroup._def },
    (prev) => {
      if (!prev?.pages?.length) return prev;

      let changed = false;
      const pages = prev.pages.map((page) => {
        const itemIds = page.group.itemIds.filter((id) => !entityIds.has(id));
        const removed = page.group.itemIds.length - itemIds.length;
        let items = page.items;

        for (const id of entityIds) {
          if (id in items) {
            if (items === page.items) items = { ...page.items };
            delete items[id];
            changed = true;
          }
        }

        if (removed === 0) {
          return items === page.items ? page : { ...page, items };
        }

        changed = true;
        return {
          ...page,
          items,
          group: {
            ...page.group,
            itemIds,
            totalCount: Math.max(0, page.group.totalCount - removed),
          },
        };
      });

      return changed ? { ...prev, pages } : prev;
    }
  );
}

function getSoupItemFilterForQueryKey(
  queryKey: QueryKey
): SoupApiItemFilter | undefined {
  return queryClient.getQueryCache().find({ queryKey })?.meta?.itemFilter as
    | SoupApiItemFilter
    | undefined;
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
