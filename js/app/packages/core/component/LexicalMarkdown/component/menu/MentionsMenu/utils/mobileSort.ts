import { createFreshSearch } from '@core/util/freshSort';
import type { MentionItem } from '../../../../utils/mentionsUtils';

export const mobileAllSearch = createFreshSearch<MentionItem>({
  config: {
    useViewedAt: true,
    fuzzyWeight: 0.4,
    timeWeight: 0.6,
    brevityWeight: 0,
  },
  getName: (item) => {
    if (item.kind === 'date') return item.data.displayText;
    if (item.kind === 'group') return item.data.groupAlias;
    return item.searchText;
  },
  getTimestamp: (item) => {
    if (item.kind === 'date' || item.kind === 'group') return {};
    return item.timestamps;
  },
});

/**
 * Sort users/groups first (matching desktop's People & Groups bucket),
 * then interleave the remaining mention sources by freshness. Without
 * this split, channel members get buried under recently-touched docs.
 */
export function sortMobileMentions(
  peopleAndGroups: MentionItem[],
  others: MentionItem[],
  query: string
): MentionItem[] {
  const sortedPeople = mobileAllSearch(peopleAndGroups, query).map(
    ({ item }) => item
  );
  const sortedOthers = mobileAllSearch(others, query).map(({ item }) => item);
  return [...sortedPeople, ...sortedOthers];
}
