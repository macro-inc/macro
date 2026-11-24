import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import type { SoupAstItemsQueryArgs } from '@queries/soup/items';

/**
 * One document, for its owner and timestamps. Sorted by update time so the
 * GraphQL list can answer from the local cache before the network.
 */
export function documentMetadataArgs(
  documentId: string
): SoupAstItemsQueryArgs {
  return {
    params: { limit: 1, sort_method: 'updated_at' },
    body: compileToAst(
      queryStateFrom(
        defineQueryFilters({ include: { documentId: [documentId] } })
      )
    ),
  };
}
