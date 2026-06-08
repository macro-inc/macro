import type { SoupApiItem } from '@service-storage/generated/schemas';
import type { InfiniteData, QueryKey } from '@tanstack/solid-query';

import { queryClient } from '../../client';
import {
  computeGroupKeysForItem,
  extractGroupByFromKey,
  type ResolvedGroupMeta,
  resolveGroupMetaForKey,
} from '../grouped/api';
import type { GroupByField, GroupMeta } from '../grouped/types';
import type { SoupApiItemFilter, SoupAstItemsGroupedPage } from '../items';
import { soupKeys } from '../keys';

type GroupedGroupPage = {
  items: Record<string, SoupApiItem>;
  group: GroupMeta;
};

type GroupedGroupInfiniteData = InfiniteData<GroupedGroupPage, unknown>;

export function reconcileGroupedCachesForEntity(
  entityId: string,
  entity: SoupApiItem
): void {
  const caches = queryClient.getQueriesData<InfiniteData<unknown, unknown>>({
    queryKey: soupKeys.astItems._def,
  });

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

    if (needsInvalidation || !changed) continue;

    queryClient.setQueryData(key, { ...prev, pages });
  }
}

export function reconcileGroupedGroupQueriesForEntity(
  entityId: string,
  entity: SoupApiItem
): void {
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

export function insertIntoGroupedPage(
  page: SoupAstItemsGroupedPage,
  item: SoupApiItem,
  itemId: string,
  groupBy: GroupByField | undefined
): SoupAstItemsGroupedPage | undefined {
  const newKeys = computeGroupKeysForItem(item, groupBy);
  if (newKeys === undefined || newKeys.length === 0) return;

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

export function insertIntoGroupedGroupQueries(
  item: SoupApiItem,
  itemId: string
): void {
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

export function removeEntitiesFromGroupedPage(
  page: SoupAstItemsGroupedPage,
  entityIds: Set<string>
): SoupAstItemsGroupedPage {
  const groups: GroupMeta[] = [];
  let changed = false;

  for (const group of page.groups) {
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
  for (const [id, item] of Object.entries(page.items)) {
    if (entityIds.has(id)) {
      changed = true;
      continue;
    }

    items[id] = item;
  }

  return changed ? { ...page, items, groups } : page;
}

export function removeFromGroupedGroupQueries(entityIds: Set<string>): void {
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

export function getSoupItemFilterForQueryKey(
  queryKey: QueryKey
): SoupApiItemFilter | undefined {
  return queryClient.getQueryCache().find({ queryKey })?.meta?.itemFilter as
    | SoupApiItemFilter
    | undefined;
}

function extractGroupedGroupKeyFromKey(key: QueryKey): string | undefined {
  const markerIndex = key.indexOf('group');
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

    if (hasEntity === shouldInsert) {
      groups.push(group);
      continue;
    }

    changed = true;
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
