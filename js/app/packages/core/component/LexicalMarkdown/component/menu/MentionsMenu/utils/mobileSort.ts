import { createFreshSearch, type FreshSortConfig } from '@core/util/freshSort';
import type { MentionItem } from '../../../../utils/mentionsUtils';

function getMentionName(item: MentionItem): string {
  if (item.kind === 'date') return item.data.displayText;
  if (item.kind === 'group') return item.data.groupAlias;
  return item.searchText;
}

function getMentionTimestamps(item: MentionItem) {
  if (item.kind === 'date' || item.kind === 'group') return {};
  return item.timestamps;
}

function isDmItem(item: MentionItem): boolean {
  return item.kind === 'entity' && item.bucket === 'dm';
}

/**
 * Per-kind boost: surfaces fresh users above similarly-fresh docs/channels
 * without strictly pinning every user to the top. Mirrors the command menu's
 * approach of using boosts to interleave categories rather than separating
 * them into ordered buckets.
 */
function mentionBoost(item: MentionItem): number {
  if (item.kind === 'user') return 0.2;
  if (item.kind === 'group') return 0.1;
  return 0;
}

function createMobileSearchConfig(
  hasQuery: boolean
): FreshSortConfig<MentionItem> {
  return {
    useViewedAt: true,
    fuzzyWeight: hasQuery ? 0.7 : 0,
    timeWeight: hasQuery ? 0.7 : 0.9,
    brevityWeight: 0,
    minFuzzyThreshold: hasQuery ? 0.1 : 0,
    dmBoost: hasQuery ? 1.8 : 1.2,
    commaSeparatedChannelMatch: true,
    boostFn: mentionBoost,
  };
}

export function sortMobileMentions(
  items: MentionItem[],
  query: string
): MentionItem[] {
  const hasQuery = query.trim().length > 0;
  const search = createFreshSearch<MentionItem>({
    config: createMobileSearchConfig(hasQuery),
    getName: getMentionName,
    isDmItem,
    getTimestamp: getMentionTimestamps,
  });
  return search(items, query).map(({ item }) => item);
}
