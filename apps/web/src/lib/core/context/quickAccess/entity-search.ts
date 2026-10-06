import { createFreshSearch } from '@core/util/freshSort';
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

/** Collapse cached team records while retaining the selected result's ranking. */
export function deduplicateContactItems<T extends QuickAccessItem>(
  items: T[]
): T[] {
  const winners = new Map<string, T>();
  for (const item of items) {
    if (item.kind !== 'entity' || item.data.type !== 'crm_contact') continue;
    if (item.data.hidden) continue;
    const email = item.data.email.trim().toLowerCase();
    const previous = winners.get(email);
    if (
      !previous ||
      item.sortTimestamp > previous.sortTimestamp ||
      (item.sortTimestamp === previous.sortTimestamp && item.id > previous.id)
    ) {
      winners.set(email, item);
    }
  }
  return items.filter(
    (item) =>
      item.kind !== 'entity' ||
      item.data.type !== 'crm_contact' ||
      winners.get(item.data.email.trim().toLowerCase()) === item
  );
}
