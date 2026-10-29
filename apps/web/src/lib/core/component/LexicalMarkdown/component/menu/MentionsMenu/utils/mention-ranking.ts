import type { EntityBucket } from '@core/context/quickAccess';
import { createFreshSearch, type FreshSortConfig } from '@core/util/freshSort';
import type { MentionItem } from '../../../../utils/mentionsUtils';

type MentionRankingProfile = {
  search: FreshSortConfig<MentionItem>;
  kindBoosts: Partial<Record<MentionItem['kind'], number>>;
  bucketBoosts: Partial<Record<EntityBucket, number>>;
  exactNameBoost: number;
  prefixNameBoost: number;
};

/** Additive boosts: 0.5 means a 1.5x multiplier on the blended score.
 * `initiative` is a task project; `project` is a Drive folder. */
export const MENTION_RANKING_CONFIG: Record<
  'query' | 'browse',
  MentionRankingProfile
> = {
  query: {
    search: {
      useViewedAt: true,
      fuzzyWeight: 0.7,
      timeWeight: 0.2,
      brevityWeight: 0.1,
      gapPenaltyWeight: 0.4,
      startBonusDecay: 0.2,
      dmBoost: 1.4,
    },
    kindBoosts: { user: 0.6, group: 0.2 },
    bucketBoosts: {
      initiative: 0.6,
      project: 0.2,
      database: 0.2,
      snippet: 0.15,
    },
    exactNameBoost: 2,
    prefixNameBoost: 0.25,
  },
  browse: {
    search: {
      useViewedAt: true,
      fuzzyWeight: 0,
      timeWeight: 0.9,
      minFuzzyThreshold: 0,
      dmBoost: 1.2,
    },
    kindBoosts: { user: 0.2, group: 0.1 },
    bucketBoosts: {},
    exactNameBoost: 0,
    prefixNameBoost: 0,
  },
};

function getMentionName(item: MentionItem): string {
  if (item.kind === 'date') return item.data.displayText;
  if (item.kind === 'group') return item.data.groupAlias;
  if (item.kind === 'bookingLink' || item.kind === 'calendarEvent')
    return item.data.title;
  if (item.kind === 'externalChat') return item.data.name;
  return item.searchText;
}

function getMentionTimestamps(item: MentionItem) {
  return 'timestamps' in item ? item.timestamps : {};
}

/** Rank all loaded sources together before the menu takes its preview rows.
 * Preserve source matches when cache/server matching is broader than uFuzzy. */
export function rankMentions<T extends MentionItem>(
  items: T[],
  query: string,
  preserveMatches = false
): T[] {
  const term = query.trim().toLocaleLowerCase();
  const profile = MENTION_RANKING_CONFIG[term ? 'query' : 'browse'];
  const search = createFreshSearch<T>({
    config: {
      ...profile.search,
      boostFn: (item) => {
        let boost = profile.kindBoosts[item.kind] ?? 0;
        if (item.kind === 'entity')
          boost += profile.bucketBoosts[item.bucket] ?? 0;
        const name = getMentionName(item).trim().toLocaleLowerCase();
        if (term && name === term) boost += profile.exactNameBoost;
        else if (term && name.startsWith(term))
          boost += profile.prefixNameBoost;
        return boost;
      },
    },
    getName: getMentionName,
    isDmItem: (item) => item.kind === 'entity' && item.bucket === 'dm',
    getTimestamp: getMentionTimestamps,
  });
  const ranked = search(items, query.trim()).map(({ item }) => item);
  if (!preserveMatches) return ranked;

  const rankedIds = new Set(ranked.map((item) => item.id));
  return [...ranked, ...items.filter((item) => !rankedIds.has(item.id))];
}
