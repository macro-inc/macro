import type { EntityBucket } from '@core/context/quickAccess';
import {
  createFreshSearch,
  type FreshSortConfig,
  NAME_MATCH_RANKING,
} from '@core/util/freshSort';
import type { MentionItem } from '../../../../utils/mentionsUtils';

type MentionRankingProfile = {
  search: FreshSortConfig<MentionItem>;
  kindBoosts: Partial<Record<MentionItem['kind'], number>>;
  bucketBoosts: Partial<Record<EntityBucket, number>>;
};

/** Additive boosts: 0.5 means a 1.5x multiplier on the blended score.
 * `initiative` is a task project; `project` is a Drive folder. */
export const MENTION_RANKING_CONFIG: Record<
  'query' | 'browse',
  MentionRankingProfile
> = {
  query: {
    search: {
      ...NAME_MATCH_RANKING,
      useViewedAt: true,
      fuzzyWeight: 0.7,
      timeWeight: 0.2,
      brevityWeight: 0.1,
      dmBoost: 1.4,
    },
    kindBoosts: { user: 0.6, group: 0.2 },
    bucketBoosts: {
      initiative: 0.6,
      project: 0.2,
      database: 0.2,
      snippet: 0.15,
    },
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
  },
};

function getMentionName(item: MentionItem): string {
  if (item.kind === 'date') return item.data.displayText;
  if (item.kind === 'group') return item.data.groupAlias;
  if (item.kind === 'bookingLink' || item.kind === 'calendarEvent')
    return item.data.title;
  if (item.kind === 'externalChat' || item.kind === 'routine')
    return item.data.name;
  return item.searchText;
}

/** Entity and user search text can add emails or aliases after the name. */
function getMentionDisplayName(item: MentionItem): string {
  if (item.kind === 'entity' || item.kind === 'user') return item.data.name;
  return getMentionName(item);
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
  const profile = MENTION_RANKING_CONFIG[query.trim() ? 'query' : 'browse'];
  const search = createFreshSearch<T>({
    config: {
      ...profile.search,
      boostFn: (item) => {
        let boost = profile.kindBoosts[item.kind] ?? 0;
        if (item.kind === 'entity')
          boost += profile.bucketBoosts[item.bucket] ?? 0;
        return boost;
      },
    },
    getName: getMentionName,
    getDisplayName: getMentionDisplayName,
    isDmItem: (item) => item.kind === 'entity' && item.bucket === 'dm',
    getTimestamp: getMentionTimestamps,
  });
  const ranked = search(items, query.trim()).map(({ item }) => item);
  if (!preserveMatches) return ranked;

  const rankedIds = new Set(ranked.map((item) => item.id));
  return [...ranked, ...items.filter((item) => !rankedIds.has(item.id))];
}
