import { fuzzyMatch } from '@core/util/fuzzy';
import { mergeAdjacentMacroEmTags } from '@core/util/searchHighlight';
import { createFreshSearch } from '@core/util/freshSort';
import type { EntityData, WithSearch } from '@entity';
import type { FilterConfig } from './filters/create-filter-state';

export const getValidSearchFilters = <T>(
  filters: readonly FilterConfig<T>[]
) => {
  return filters.filter((f) => f.id !== 'explicit-noise');
};

/** Takes a list of entity pools and returns a list of unique entities that are present in all pools, deduplicating by id */
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
      if (!seen.has(entity.id)) {
        seen.add(entity.id);
        idCounts.set(entity.id, (idCounts.get(entity.id) ?? 0) + 1);
        if (!entityById.has(entity.id)) {
          entityById.set(entity.id, entity);
        }
      }
    }
  }

  const result: EntityData[] = [];
  for (const [id, count] of idCounts) {
    if (count === pools.length) {
      result.push(entityById.get(id)!);
    }
  }

  return result;
}

/** Adds name highlight to item list based on fuzzy match */
export const nameFuzzySearchFilter = (
  items: EntityData[],
  query: string
): EntityData[] | WithSearch<EntityData>[] => {
  if (!query || query.length === 0) return items;

  const matchResults = fuzzyMatch(query, items, (item) => item.name, {
    noSort: true,
  });

  const resultMap = new Map(
    matchResults.map((r) => [
      r.item.id,
      { nameHighlight: r.nameHighlight, score: r.score },
    ])
  );
  return items
    .filter((item) => resultMap.has(item.id))
    .map((item) => {
      const matchResult = resultMap.get(item.id)!;
      return {
        ...item,
        search: {
          nameHighlight: mergeAdjacentMacroEmTags(matchResult.nameHighlight),
          senderHighlightTerms: null,
          contentHitData: null,
          source: 'local',
        },
      } as WithSearch<EntityData>;
    });
};

export const createSoupFreshSearch = () =>
  createFreshSearch<EntityData>(
    {
      useViewedAt: true,
      channelBoost: 3,
      fuzzyWeight: 0.7,
      timeWeight: 0.3,
      minFuzzyThreshold: 0.1,
      commaSeparatedChannelMatch: true,
    },
    (item) => item.name,
    (item) => item.type === 'channel',
    (item) => item
  );
