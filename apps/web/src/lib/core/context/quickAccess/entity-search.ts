import { createFreshSearch } from '@core/util/freshSort';
import type { EntityItem, QuickAccessItem } from './types';

const quickAccessSearch = createFreshSearch<QuickAccessItem>({
  config: { useViewedAt: true },
  getName: (item) => item.searchText,
  isChannelItem: (item) => item.bucket === 'channel',
  getTimestamp: (item) => item.timestamps,
});

/** Fuzzy-ranks entity candidates using the existing mentions semantics. */
export function searchQuickAccessItems(
  items: QuickAccessItem[],
  query: string
): QuickAccessItem[] {
  if (!query.trim()) return items;
  return quickAccessSearch(items, query).map(({ item }) => item);
}

/** Fuzzy-ranks entity candidates using the existing mentions semantics. */
export function searchQuickAccessEntities(
  items: EntityItem[],
  query: string
): EntityItem[] {
  return searchQuickAccessItems(items, query) as EntityItem[];
}
