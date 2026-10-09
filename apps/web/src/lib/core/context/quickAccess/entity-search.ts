import { createFreshSearch } from '@core/util/freshSort';
import { matchesTokenSubsequences } from '@core/util/string';
import type { EntityItem, QuickAccessItem } from './types';

const quickAccessSearch = createFreshSearch<QuickAccessItem>({
  config: { useViewedAt: true },
  getName: (item) => item.searchText,
  isChannelItem: (item) => item.bucket === 'channel',
  getTimestamp: (item) => item.timestamps,
});

/** Filter a pending cache search without replacing its established ranking.
 * Match tokens as ordered subsequences, as cache-core/search.rs does; uFuzzy's
 * stricter matching would drop cached hits only to restore them on completion. */
export function filterQuickAccessItems(
  items: QuickAccessItem[],
  query: string
): QuickAccessItem[] {
  if (!query.trim()) return items;
  return items.filter((item) =>
    matchesTokenSubsequences(item.searchText, query)
  );
}

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
