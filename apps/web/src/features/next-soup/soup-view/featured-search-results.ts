import type { EntityData } from '@entity';
import type { WithSearch } from '@entity/types/search';

/** The local name matches whose list row data comes from Soup. */
export function featuredDocumentIds(local: readonly EntityData[]): string[] {
  return local
    .filter((entity) => entity.type === 'document')
    .map((entity) => entity.id);
}

/**
 * Gives each local name match the row data its Soup record carries, keeping
 * the match's own highlight.
 */
export function withFeaturedDocumentData<T extends WithSearch<EntityData>>(
  local: readonly T[],
  documents: readonly EntityData[]
): T[] {
  if (documents.length === 0) return [...local];
  const byId = new Map(documents.map((document) => [document.id, document]));
  return local.map((entity) => {
    const document = byId.get(entity.id);
    if (!document || document.type !== entity.type) return entity;
    return { ...document, search: entity.search } as T;
  });
}

/**
 * Moves the featured rows that the list still shows to its top. A featured id
 * the view's filters dropped is not featured.
 */
export function featureSearchResults<T extends { id: string }>(
  entities: readonly T[],
  featuredIds: readonly string[]
): { entities: T[]; featuredIds: string[] } {
  if (featuredIds.length === 0)
    return { entities: [...entities], featuredIds: [] };
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const featured = featuredIds.flatMap((id) => {
    const entity = byId.get(id);
    return entity ? [entity] : [];
  });
  const shown = new Set(featured.map((entity) => entity.id));
  return {
    entities: [
      ...featured,
      ...entities.filter((entity) => !shown.has(entity.id)),
    ],
    featuredIds: featured.map((entity) => entity.id),
  };
}
