import { createFreshSearch } from '@core/util/freshSort';
import { fuzzyMatch } from '@core/util/fuzzy';
import { mergeAdjacentMacroEmTags } from '@core/util/searchHighlight';
import type { EntityData, WithSearch } from '@entity';
import type { SoupSearchPoolEntry } from './context';

/** Takes a list of entity pools and returns unique entities present in every pool. */
export function intersectEntityPools(
  pools: readonly EntityData[][]
): EntityData[] {
  if (pools.length === 0) return [];
  if (pools.length === 1) return pools[0];

  const idCounts = new Map<string, number>();
  const entityById = new Map<string, EntityData>();

  for (const pool of pools) {
    const seen = new Set<string>();
    for (const entity of pool) {
      if (seen.has(entity.id)) continue;
      seen.add(entity.id);
      idCounts.set(entity.id, (idCounts.get(entity.id) ?? 0) + 1);
      if (!entityById.has(entity.id)) entityById.set(entity.id, entity);
    }
  }

  const result: EntityData[] = [];
  for (const [id, count] of idCounts) {
    if (count === pools.length) result.push(entityById.get(id)!);
  }
  return result;
}

/** Fuzzy-matches entity names and attaches local search highlights. */
export function nameFuzzySearchFilter<TEntity extends EntityData>(
  items: TEntity[],
  query: string
): WithSearch<TEntity>[] {
  if (!query) {
    return items.map((item) => ({
      ...item,
      search: {
        nameHighlight: null,
        senderHighlightTerms: null,
        contentHitData: null,
        source: 'local',
      },
    }));
  }

  return fuzzyMatch(query, items, (item) => item.name, { noSort: true }).map(
    ({ item, nameHighlight }) => ({
      ...item,
      search: {
        nameHighlight: mergeAdjacentMacroEmTags(nameHighlight),
        senderHighlightTerms: null,
        contentHitData: null,
        source: 'local',
      },
    })
  );
}

export const createSoupFreshSearch = () =>
  createFreshSearch<SoupSearchPoolEntry>({
    config: {
      useViewedAt: true,
      channelBoost: 3,
      dmBoost: 1.5,
      fuzzyWeight: 0.7,
      timeWeight: 0.3,
      minFuzzyThreshold: 0.1,
      commaSeparatedChannelMatch: true,
    },
    getName: (item) => item.data.name,
    isChannelItem: (item) => item.data.type === 'channel',
    isDmItem: (item) => item.bucket === 'dm',
    getTimestamp: (item) => ({
      viewedAt: item.data.viewedAt,
      updatedAt: item.data.updatedAt,
    }),
  });
