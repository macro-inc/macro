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
 * Per-kind boost. With a query, the user is usually targeting a specific
 * person, so users beat group DMs/channels that merely contain that name —
 * the command menu sidesteps this by excluding persons from its "all" view,
 * but the mention menu must include them. Without a query we keep the boost
 * small so freshness dominates.
 */
function mentionBoost(hasQuery: boolean) {
  return (item: MentionItem): number => {
    if (item.kind === 'user') return hasQuery ? 0.4 : 0.2;
    if (item.kind === 'group') return hasQuery ? 0.2 : 0.1;
    return 0;
  };
}

function createMobileSearchConfig(
  hasQuery: boolean
): FreshSortConfig<MentionItem> {
  return {
    useViewedAt: true,
    fuzzyWeight: hasQuery ? 0.5 : 0,
    timeWeight: hasQuery ? 0.4 : 0.9,
    brevityWeight: hasQuery ? 0.1 : 0,
    minFuzzyThreshold: hasQuery ? 0.1 : 0,
    dmBoost: hasQuery ? 1.4 : 1.2,
    commaSeparatedChannelMatch: true,
    gapPenaltyWeight: hasQuery ? 0.4 : 0,
    startBonusDecay: hasQuery ? 0.4 : 0,
    boostFn: mentionBoost(hasQuery),
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
