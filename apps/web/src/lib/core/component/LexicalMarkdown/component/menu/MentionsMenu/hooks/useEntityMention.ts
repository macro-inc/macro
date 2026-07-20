import {
  type EntityBucket,
  type EntityItem,
  type QuickAccessList,
  useQuickAccess,
} from '@core/context/quickAccess';
import { searchQuickAccessEntities } from '@core/context/quickAccess/entity-search';
import { createLazyMemo } from '@solid-primitives/memo';
import type { Accessor } from 'solid-js';

type UseEntityMentionOptions = {
  buckets: EntityBucket[];
  searchTerm: Accessor<string>;
};

type UseEntityMentionResult = {
  entities: Accessor<EntityItem[]>;
  totalCount: Accessor<number>;
  hasMore: Accessor<boolean>;
  isLoading: Accessor<boolean>;
  isLoadingMore: Accessor<boolean>;
  loadMore: () => Promise<void>;
};

/**
 * Generic hook for managing entity mentions in the mentions menu.
 * Can be used for documents, channels, or any combination of entity buckets.
 */
export function useEntityMention(
  options: UseEntityMentionOptions
): UseEntityMentionResult {
  const quickAccess = useQuickAccess();
  const entityList = quickAccess.useList({
    buckets: options.buckets,
    searchTerm: options.searchTerm,
  }) as QuickAccessList<EntityItem>;
  const entities = createLazyMemo(() => {
    if (quickAccess.usesRecordSelection()) return entityList.items();
    return searchQuickAccessEntities(entityList.items(), options.searchTerm());
  });

  return {
    entities,
    totalCount: () =>
      quickAccess.usesRecordSelection()
        ? entityList.totalCount()
        : entities().length,
    hasMore: () => quickAccess.usesRecordSelection() && entityList.hasMore(),
    isLoading: () =>
      quickAccess.usesRecordSelection()
        ? entityList.isLoading()
        : quickAccess.isLoading(),
    isLoadingMore: () =>
      quickAccess.usesRecordSelection() && entityList.isLoadingMore(),
    loadMore: async () => {
      if (quickAccess.usesRecordSelection()) await entityList.loadMore();
    },
  };
}

type UseEntityMentionFromListOptions = {
  items: Accessor<EntityItem[]>;
  searchTerm: Accessor<string>;
  buckets: EntityBucket[];
};

/**
 * Like useEntityMention but takes a pre-built list of EntityItems
 * instead of reading from quickAccess. Useful for sandbox/onboarding scenarios.
 */
export function useEntityMentionFromList(
  options: UseEntityMentionFromListOptions
): UseEntityMentionResult {
  const { items, searchTerm, buckets } = options;
  const bucketSet = new Set<string>(buckets);

  const entitiesList = createLazyMemo(() =>
    items().filter((item) => bucketSet.has(item.bucket))
  );

  const entities = createLazyMemo(() =>
    searchQuickAccessEntities(entitiesList(), searchTerm())
  );

  return {
    entities,
    totalCount: () => entities().length,
    hasMore: () => false,
    isLoading: () => false,
    isLoadingMore: () => false,
    loadMore: async () => undefined,
  };
}
