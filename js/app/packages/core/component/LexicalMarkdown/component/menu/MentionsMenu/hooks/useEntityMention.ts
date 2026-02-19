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

  const entitySearch = createFreshSearch<EntityItem>(
    { useViewedAt: true },
    (item) => item.searchText,
    (item) => item.bucket === 'channel',
    (item) => item.timestamps
  );

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
