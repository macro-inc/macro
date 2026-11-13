import { arrayEquals } from '@core/util/compareUtils';
import { debouncedDependent } from '@core/util/debounce';
import type { EntityData } from '@entity';
import { queryReadyGate } from '@queries/gate';
import {
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { type Accessor, createMemo } from 'solid-js';
import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '../filters/filter-store';

/** Featured rows change with every keystroke; read the ones typing settles on. */
const FEATURED_READ_DEBOUNCE_MS = 150;

export function featuredDocumentsQueryArgs(
  documentIds: readonly string[]
): SoupAstItemsQueryArgs {
  return {
    params: {
      limit: Math.max(1, documentIds.length),
      sort_method: 'updated_at',
    },
    body: compileToAst(
      queryStateFrom(
        defineQueryFilters({ include: { documentId: [...documentIds] } })
      )
    ),
  };
}

/**
 * The list rows of the documents and tasks a search features by name. Local
 * name matches carry no properties, so the featured few are read as Soup rows:
 * from the cache when it holds them, from the server otherwise.
 */
export function useFeaturedDocuments(
  documentIds: Accessor<readonly string[]>
): Accessor<EntityData[]> {
  const featured = createMemo(() => [...new Set(documentIds())].sort(), [], {
    equals: arrayEquals,
  });
  const ids = debouncedDependent(featured, FEATURED_READ_DEBOUNCE_MS);
  const query = useSoupAstItemsQuery(
    () => featuredDocumentsQueryArgs(ids()),
    () => ({
      enabled: ids().length > 0,
      staleTime: 30_000,
      graphqlCacheFirstEntities: ids().map((entityId) => ({
        entityType: 'DOCUMENT' as const,
        entityId,
      })),
    })
  );
  return () =>
    ids().length > 0 && queryReadyGate(query) ? query.data.entities : [];
}
