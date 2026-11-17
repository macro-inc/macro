import { nameFuzzySearchFilter } from '@app/features/soup/search/utils';
import type { EntityData } from '@entity';

const entityKey = (entity: EntityData) => `${entity.type}:${entity.id}`;

/**
 * Home's search results over a server-listed feed. The search service cannot
 * express the feed's membership, so its hits alone leave out rows Home is
 * showing. Every listed row whose name matches comes first, in Home's order,
 * followed by the search hits that are not already among them.
 */
export function searchListedHomeEntities<T extends EntityData>(
  listed: readonly T[],
  hits: readonly T[],
  query: string
): T[] {
  const position = new Map(
    listed.map((entity, index) => [entityKey(entity), index])
  );

  const matches = nameFuzzySearchFilter([...listed], query).sort(
    (a, b) =>
      (position.get(entityKey(a)) ?? 0) - (position.get(entityKey(b)) ?? 0)
  );
  const matched = new Set(matches.map(entityKey));

  return [...matches, ...hits.filter((hit) => !matched.has(entityKey(hit)))];
}
