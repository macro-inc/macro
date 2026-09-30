import { createFreshSearch, type TimestampedItem } from '@core/util/freshSort';
import type { EntityItem, QuickAccessItem } from './types';

type Rankable = {
  searchText: string;
  timestamps: TimestampedItem;
  bucket?: string;
};

const createQuickAccessSearch = <T extends Rankable>() =>
  createFreshSearch<T>({
    config: { useViewedAt: true },
    getName: (item) => item.searchText,
    isChannelItem: (item) => item.bucket === 'channel',
    getTimestamp: (item) => item.timestamps,
  });

const quickAccessSearch = createQuickAccessSearch<QuickAccessItem>();
const rankableSearch = createQuickAccessSearch<Rankable>();

/** Ranks items quick access doesn't index with the same semantics as its own. */
export function searchLikeQuickAccess<T extends Rankable>(
  items: T[],
  query: string
): T[] {
  if (!query.trim()) return items;
  return rankableSearch(items, query).map(({ item }) => item as T);
}

/** Filter a pending cache search without replacing its established ranking.
 * Match tokens as ordered subsequences, as cache-core/search.rs does; uFuzzy's
 * stricter matching would drop cached hits only to restore them on completion. */
export function filterQuickAccessItems(
  items: QuickAccessItem[],
  query: string
): QuickAccessItem[] {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return items;

  return items.filter((item) => {
    const text = item.searchText.toLowerCase();
    return tokens.every((token) => {
      let position = 0;
      for (const character of token) {
        const next = text.indexOf(character, position);
        if (next === -1) return false;
        position = next + character.length;
      }
      return true;
    });
  });
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
