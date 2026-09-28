import { createFreshSearch } from '@core/util/freshSort';
import type { CommandMenuItem } from './useCommandItems';

const search = createFreshSearch<CommandMenuItem>({
  config: {
    useViewedAt: true,
    dmBoost: 1.8,
    fuzzyWeight: 0.7,
    timeWeight: 0.7,
    minFuzzyThreshold: 0.1,
    commaSeparatedChannelMatch: true,
  },
  getName: (item) => item.searchText,
  isDmItem: (item) => item.bucket === 'dm',
  getTimestamp: (item) => item.timestamps,
});

function compareRecency(left: CommandMenuItem, right: CommandMenuItem) {
  return (
    right.sortTimestamp - left.sortTimestamp || left.id.localeCompare(right.id)
  );
}

/** Rank cached and local candidates together using the command menu's rules. */
export function rankCommandSearchItems(
  items: CommandMenuItem[],
  query: string,
  options: { preserveAdditionalEntityMatches: boolean }
): CommandMenuItem[] {
  const ranked = search(items, query)
    .sort(
      (left, right) =>
        right.combinedScore - left.combinedScore ||
        compareRecency(left.item, right.item)
    )
    .map(({ item }) => item);
  if (!options.preserveAdditionalEntityMatches) return ranked;

  // Cache search accepts broader subsequences than the menu's fuzzy matcher.
  // Keep these additional matches reachable after the regular ranked results.
  const matchedIds = new Set(ranked.map((item) => item.id));
  const additional = items
    .filter((item) => item.kind === 'entity' && !matchedIds.has(item.id))
    .sort(compareRecency);
  return [...ranked, ...additional];
}
