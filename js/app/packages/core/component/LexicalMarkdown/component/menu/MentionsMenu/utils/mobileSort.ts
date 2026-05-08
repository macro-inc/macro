import { createFreshSearch, type FreshSortConfig } from '@core/util/freshSort';
import type { MentionItem } from '../../../../utils/mentionsUtils';

function getMentionName(item: MentionItem): string {
  if (item.kind === 'date') return item.data.displayText;
  if (item.kind === 'group') return item.data.groupAlias;
  return item.searchText;
}

function getMentionTimestamps(item: MentionItem) {
  if (item.kind === 'date' || item.kind === 'group') return {};
  if (item.kind === 'user') {
    const last = item.timestamps.lastInteraction;
    if (last) return { viewedAt: last, updatedAt: last, lastInteraction: last };
    // Workspace users typically have empty timestamps. Real teammates have
    // a display name distinct from their email; treat them as freshly-active
    // so they don't lose purely on time to recently-viewed group DMs that
    // contain their name. Users without a display name (test/onboarding
    // accounts) get no time signal and rank only on match quality.
    const hasDisplayName =
      !!item.data.name && item.data.name !== item.data.email;
    if (hasDisplayName) {
      const now = new Date();
      return { viewedAt: now, updatedAt: now, lastInteraction: now };
    }
    return {};
  }
  return item.timestamps;
}

/**
 * Per-kind boost. Groups (@here etc.) get a small nudge; users compete on
 * equal terms with entities — synthetic-fresh time for real users (see
 * getMentionTimestamps) is enough to surface them without an extra boost,
 * which over-weighted them on broad queries like @test.
 */
function mentionBoost(hasQuery: boolean) {
  return (item: MentionItem): number => {
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
    commaSeparatedChannelMatch: true,
    gapPenaltyWeight: hasQuery ? 0.4 : 0,
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
    getTimestamp: getMentionTimestamps,
  });
  return search(items, query).map(({ item }) => item);
}
