import { createFreshSearch } from '@core/util/freshSort';
import type { EntityItem } from './types';

const entitySearch = createFreshSearch<EntityItem>({
  config: { useViewedAt: true },
  getName: (item) => item.searchText,
  isChannelItem: (item) => item.bucket === 'channel',
  getTimestamp: (item) => item.timestamps,
});

/** Fuzzy-ranks entity candidates using the existing mentions semantics. */
export function searchQuickAccessEntities(
  items: EntityItem[],
  query: string
): EntityItem[] {
  if (!query.trim()) return items;
  return entitySearch(items, query).map(({ item }) => item);
}
