import type { SoupApiItem } from '@service-storage/generated/schemas';
import type { InfiniteData } from '@tanstack/solid-query';

import { queryClient } from '../../client';
import {
  computeGroupKeysForItem,
  type ResolvedGroupMeta,
  resolveGroupMetaForKey,
} from '../grouped/api';
import type { GroupByField, GroupMeta } from '../grouped/types';
import type { SoupAstItemsGroupedPage } from '../items';
import { soupKeys } from '../keys';
import { getSoupQueryMeta } from './utils';

type GroupedGroupPage = {
  items: Record<string, SoupApiItem>;
  group: GroupMeta;
};

type GroupedGroupInfiniteData = InfiniteData<GroupedGroupPage, unknown>;

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

/** Builds a new optimistic group containing a single item. */
function makeGroup(meta: ResolvedGroupMeta, entityId: string): GroupMeta {
  return {
    ...meta,
    totalCount: 1,
    itemIds: [entityId],
    nextCursor: null,
  };
}

/** Moves an item id to the front of a group, incrementing count only if new. */
function prependId(group: GroupMeta, entityId: string): GroupMeta {
  const existing = group.itemIds.includes(entityId);

  return {
    ...group,
    itemIds: existing
      ? [entityId, ...group.itemIds.filter((id) => id !== entityId)]
      : [entityId, ...group.itemIds],
    totalCount: existing ? group.totalCount : group.totalCount + 1,
  };
}

/** Removes an item id from a group and decrements the total count safely. */
function removeId(group: GroupMeta, entityId: string): GroupMeta {
  if (!group.itemIds.includes(entityId)) return group;

  return {
    ...group,
    itemIds: group.itemIds.filter((id) => id !== entityId),
    totalCount: Math.max(0, group.totalCount - 1),
  };
}

/**
 * Recomputes an updated item's memberships across grouped parent AST queries.
 * Updates only resolvable grouped pages; unresolved grouping metadata is left
 * unchanged so callers can rely on later invalidation/refetch behavior.
 */
export function syncGroupedParents(entityId: string, entity: SoupApiItem) {
  const queries = queryClient.getQueryCache().findAll({
    queryKey: soupKeys.astItems._def,
  });

  for (const query of queries) {
    const prev = query.state.data as InfiniteData<unknown, unknown> | undefined;

    if (!prev || !Array.isArray(prev.pages) || prev.pages.length === 0) {
      continue;
    }

    const meta = getSoupQueryMeta(query.meta);

    if (!meta.groupBy) continue;

    // Empty memberships when the entity fails the query's item filter, so
    // `syncMembership` drops it instead of bucketing it into an unrelated
    // view. Mirrors the `meta.itemFilter` gate in `syncGroupQueries`.
    const filter = meta.itemFilter;
    const nextGroupKeys =
      filter && !filter(entity)
        ? []
        : computeGroupKeysForItem(entity, meta.groupBy);

    if (nextGroupKeys === undefined) {
      queryClient.invalidateQueries({ queryKey: query.queryKey });
      continue;
    }

    let changed = false;
    let needsInvalidation = false;

    const pages = [];
    for (const page of prev.pages) {
      if (!isGroupedPage(page)) {
        pages.push(page);
        continue;
      }

      const next = syncMembership(
        page,
        entityId,
        nextGroupKeys,
        entity,
        meta.groupBy
      );

      if (!next) {
        needsInvalidation = true;
        pages.push(page);
        continue;
      }

      if (next !== page) changed = true;
      pages.push(next);
    }

    if (needsInvalidation) {
      queryClient.invalidateQueries({ queryKey: query.queryKey });
      continue;
    }

    if (!changed) continue;

    query.setData({ ...prev, pages }, { manual: true });
  }
}

/**
 * Reconciles expanded single-group queries after an item changes.
 * Adds the item to matching first pages and removes it from groups it no
 * longer belongs to or no longer passes the query's item filter for.
 */
export function syncGroupQueries(entityId: string, entity: SoupApiItem) {
  const queries = queryClient.getQueryCache().findAll({
    queryKey: soupKeys.groupedGroup._def,
  });

  for (const query of queries) {
    const prev = query.state.data as GroupedGroupInfiniteData | undefined;
    if (!prev?.pages?.length) continue;

    const meta = getSoupQueryMeta(query.meta);
    if (!meta.groupBy || meta.groupKey == null) continue;

    const nextGroupKeys = computeGroupKeysForItem(entity, meta.groupBy);
    if (nextGroupKeys === undefined) {
      queryClient.invalidateQueries({ queryKey: query.queryKey });
      continue;
    }

    const filter = meta.itemFilter;
    let shouldHave = nextGroupKeys.includes(meta.groupKey);

    if (filter && !filter(entity)) {
      shouldHave = false;
    }

    let changed = false;

    const pages = [];
    let index = 0;
    for (const page of prev.pages) {
      const hasEntity = page.group.itemIds.includes(entityId);

      if (shouldHave && index === 0 && !hasEntity) {
        changed = true;
        pages.push({
          ...page,
          items: { ...page.items, [entityId]: entity },
          group: prependId(page.group, entityId),
        });
        index += 1;
        continue;
      }

      if (!shouldHave && hasEntity) {
        changed = true;
        const { [entityId]: _removed, ...items } = page.items;
        pages.push({
          ...page,
          items,
          group: removeId(page.group, entityId),
        });
        index += 1;
        continue;
      }

      pages.push(page);
      index += 1;
    }

    if (changed) {
      query.setData({ ...prev, pages }, { manual: true });
    }
  }
}

/**
 * Inserts an item into a grouped parent page, creating optimistic group metadata
 * for any target groups that can be resolved locally.
 */
export function insertGroupedPage(
  page: SoupAstItemsGroupedPage,
  item: SoupApiItem,
  itemId: string,
  groupBy: GroupByField | undefined
) {
  const newKeys = computeGroupKeysForItem(item, groupBy);
  if (newKeys === undefined || newKeys.length === 0) return;

  const targetKeys = new Set(newKeys);
  const existingKeys = new Set(page.groups.map((g) => g.key));
  const groups: GroupMeta[] = [];

  for (const targetKey of targetKeys) {
    if (existingKeys.has(targetKey)) continue;

    const meta = resolveGroupMetaForKey(groupBy, targetKey, item);
    if (!meta) return;

    groups.push(makeGroup(meta, itemId));
  }

  for (const group of page.groups) {
    groups.push(targetKeys.has(group.key) ? prependId(group, itemId) : group);
  }

  return {
    ...page,
    items: { ...page.items, [itemId]: item },
    groups,
  };
}

/** Inserts an item into the first page of any expanded group query it matches. */
export function insertGroupQueries(item: SoupApiItem, itemId: string) {
  const queries = queryClient.getQueryCache().findAll({
    queryKey: soupKeys.groupedGroup._def,
  });

  for (const query of queries) {
    const prev = query.state.data as GroupedGroupInfiniteData | undefined;
    if (!prev?.pages?.length) continue;

    const meta = getSoupQueryMeta(query.meta);
    const filter = meta.itemFilter;
    if (filter && !filter(item)) continue;

    if (!meta.groupBy || meta.groupKey == null) continue;

    const targetKeys = computeGroupKeysForItem(item, meta.groupBy);
    if (targetKeys === undefined) {
      queryClient.invalidateQueries({ queryKey: query.queryKey });
      continue;
    }
    if (!targetKeys.includes(meta.groupKey)) continue;

    const firstPage = prev.pages[0];
    if (firstPage.group.itemIds.includes(itemId)) continue;

    query.setData(
      {
        ...prev,
        pages: [
          {
            ...firstPage,
            items: { ...firstPage.items, [itemId]: item },
            group: prependId(firstPage.group, itemId),
          },
          ...prev.pages.slice(1),
        ],
      },
      { manual: true }
    );
  }
}

/** Removes items from a grouped parent page's item pool and group memberships. */
export function removeGroupedPage(
  page: SoupAstItemsGroupedPage,
  entityIds: Set<string>
) {
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

/** Removes items from all expanded group queries while preserving unaffected pages. */
export function removeGroupQueries(entityIds: Set<string>) {
  const queries = queryClient.getQueryCache().findAll({
    queryKey: soupKeys.groupedGroup._def,
  });

  for (const query of queries) {
    const prev = query.state.data as GroupedGroupInfiniteData | undefined;
    if (!prev?.pages?.length) continue;

    let changed = false;

    const pages = [];

    for (const page of prev.pages) {
      const itemIds = page.group.itemIds.filter((id) => !entityIds.has(id));
      const removed = page.group.itemIds.length - itemIds.length;
      let items = page.items;

      for (const id of entityIds) {
        if (id in items) {
          const { [id]: _, ...rest } = items;
          items = { ...rest };

          changed = true;
        }
      }

      if (removed === 0) {
        pages.push(items === page.items ? page : { ...page, items });
        continue;
      }

      changed = true;
      pages.push({
        ...page,
        items,
        group: {
          ...page.group,
          itemIds,
          totalCount: Math.max(0, page.group.totalCount - removed),
        },
      });
    }

    if (changed) {
      query.setData({ ...prev, pages }, { manual: true });
    }
  }
}

/** Reconcile group membership for an existing entity. Returns `undefined`
 * when a required new group cannot be created client-side and the caller should
 * invalidate instead of applying a partial optimistic move. */
function syncMembership(
  page: SoupAstItemsGroupedPage,
  entityId: string,
  nextGroupKeys: readonly string[],
  entity: SoupApiItem,
  groupBy: GroupByField | undefined
) {
  const nextGroups = new Set(nextGroupKeys);
  const currentGroups = new Set(page.groups.map((g) => g.key));

  let changed = false;

  const groups: GroupMeta[] = [];

  for (const group of nextGroups) {
    if (currentGroups.has(group)) continue;

    const meta = resolveGroupMetaForKey(groupBy, group, entity);

    if (!meta) return;

    changed = true;
    groups.push(makeGroup(meta, entityId));
  }

  for (const group of page.groups) {
    const hasEntity = group.itemIds.includes(entityId);
    const shouldInsert = nextGroups.has(group.key);

    if (hasEntity === shouldInsert) {
      groups.push(group);
      continue;
    }

    changed = true;
    groups.push(
      shouldInsert ? prependId(group, entityId) : removeId(group, entityId)
    );
  }

  if (!changed) return page;

  const newGroupsExist = nextGroups.size > 0;
  const nextItems: Record<string, SoupApiItem> = {};

  for (const [id, item] of Object.entries(page.items)) {
    if (id !== entityId || newGroupsExist) {
      nextItems[id] = item;
    }
  }

  if (newGroupsExist) {
    nextItems[entityId] = entity;
  }

  return { ...page, items: nextItems, groups };
}
