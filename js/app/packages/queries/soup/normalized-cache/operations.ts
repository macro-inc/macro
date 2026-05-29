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
import type { SoupApiItemFilter } from '../items';
import { soupKeys } from '../keys';
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
 * Optimistically update a single soup entity across all queries that reference it.
 * Returns a transaction whose `rollback()` restores only the affected queries
 * Channels: `{ tag: 'channel', data: { channel: { id, ...fields } }, frecency_score }`
 * Everything else: `{ tag, data: { id, ...fields }, frecency_score }`
 */
export function optimisticUpdateSoupEntity<T extends SoupEntityTag>(
  partial: SoupEntityPartial<T>
): SoupTransaction {
  const normalizer = getSoupNormalizer();
  const normKey = getNormalizationObjectKey(partial);

  const dependentKeys = normKey
    ? normalizer.getDependentQueriesByIds([normKey])
    : [];

  const previous = dependentKeys.map(
    (key: QueryKey) =>
      [
        key,
        queryClient.getQueryData<InfiniteData<SoupPage, unknown>>(key),
      ] as const
  );

  normalizer.setNormalizedData(partial as NormalizerData);

  return {
    rollback: () => {
      for (const [key, data] of previous) {
        queryClient.setQueryData(key, data);
      }
    },
  };
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

/**
 * Insert a new entity into the first page of every active soup list query.
 * Normy auto-normalizes the entry on insertion, making it available via `getSoupEntityById`.
 * Use for entities that don't yet exist in the cache. For existing entities use
 * `optimisticUpdateSoupEntity` (deep-merge) instead.
 */
export function insertSoupEntity(item: SoupApiItem): SoupTransaction {
  const previous = snapshotSoup();

  queryClient.setQueriesData<InfiniteData<SoupPage, unknown>>(
    {
      predicate: (query) => {
        const matchingKey =
          partialMatchKey(query.queryKey, soupKeys.astItems._def) ||
          partialMatchKey(query.queryKey, soupKeys.items._def);

        const filter = query.meta?.itemFilter as SoupApiItemFilter | undefined;
        if (!filter) return matchingKey;
        return filter(item) && matchingKey;
      },
    },
    (prev) => {
      if (!prev || !prev.pages) return prev;
      return {
        ...prev,
        pages: prev.pages.map((p, i) => {
          if (i !== 0) return p;
          return { ...p, items: [item, ...p.items] };
        }),
      };
    }
  );

  return { rollback: () => restoreSnapshot(previous) };
}

/**
 * Optimistically remove entities from all soup list queries.
 * Cancels in-flight fetches first to prevent them from re-adding removed items.
 * Snapshots the full soup cache before mutating — rollback restores everything.
 */
export function removeSoupEntities(entityIds: Set<string>): SoupTransaction {
  queryClient.cancelQueries({ queryKey: soupKeys.items._def });
  queryClient.cancelQueries({ queryKey: soupKeys.astItems._def });

  const previous = snapshotSoup();

  queryClient.setQueriesData<InfiniteData<SoupPage, unknown>>(
    {
      predicate(query) {
        return (
          partialMatchKey(query.queryKey, soupKeys.astItems._def) ||
          partialMatchKey(query.queryKey, soupKeys.items._def)
        );
      },
    },
    (prev) => {
      if (!prev || !prev.pages) return prev;
      return {
        ...prev,
        pages: prev.pages.map((page) => {
          const items = page.items.filter(
            (item) => !entityIds.has(getSoupItemId(item))
          );
          return items.length === page.items.length ? page : { ...page, items };
        }),
      };
    }
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

/** @private */
function snapshotSoup(): [
  QueryKey,
  InfiniteData<SoupPage, unknown> | undefined,
][] {
  return queryClient.getQueriesData<InfiniteData<SoupPage, unknown>>({
    queryKey: soupKeys.astItems._def,
  });
}

/** @private */
function restoreSnapshot(
  snapshot: [QueryKey, InfiniteData<SoupPage, unknown> | undefined][]
): void {
  for (const [key, data] of snapshot) {
    queryClient.setQueryData(key, data);
  }
}
