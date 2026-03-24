import type { Accessor } from 'solid-js';
import { createLazyMemo } from '@solid-primitives/memo';
import {
  useQuickAccess,
  type EntityItem,
  type EntityBucket,
} from '@core/context/quickAccess';
import { createFreshSearch } from '@core/util/freshSort';

export type UseEntityMentionOptions = {
  searchTerm: Accessor<string>;
  buckets: EntityBucket[];
};

export type UseEntityMentionResult = {
  searchedEntities: Accessor<EntityItem[]>;
  allEntities: Accessor<EntityItem[]>;
};

/**
 * Generic hook for managing entity mentions in the mentions menu.
 * Can be used for documents, channels, or any combination of entity buckets.
 */
export function useEntityMention(
  options: UseEntityMentionOptions
): UseEntityMentionResult {
  const { searchTerm, buckets } = options;
  const quickAccess = useQuickAccess();

  const entitiesList = quickAccess.useList(
    ...(buckets as [EntityBucket, ...EntityBucket[]])
  );

  const entitySearch = createFreshSearch<EntityItem>({
    config: { useViewedAt: true },
    getName: (item) => item.searchText,
    isChannelItem: (item) => item.bucket === 'channel',
    getTimestamp: (item) => item.timestamps,
  });

  const entities = createLazyMemo(() => {
    const term = searchTerm();
    if (!term) return entitiesList();
    return entitySearch(entitiesList(), term).map(({ item }) => item);
  });

  return {
    searchedEntities: entities,
    allEntities: entitiesList,
  };
}

export type UseEntityMentionFromListOptions = {
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

  const entitySearch = createFreshSearch<EntityItem>({
    config: { useViewedAt: true },
    getName: (item) => item.searchText,
    isChannelItem: (item) => item.bucket === 'channel',
    getTimestamp: (item) => item.timestamps,
  });

  const entities = createLazyMemo(() => {
    const term = searchTerm();
    if (!term) return entitiesList();
    return entitySearch(entitiesList(), term).map(({ item }) => item);
  });

  return {
    searchedEntities: entities,
    allEntities: entitiesList,
  };
}
