import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import type {
  SoupAstItemsQueryArgs,
  SoupItemsQueryOptions,
} from '@queries/soup/items';

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

/** The hover card shows no unread state; the cache may answer before the network. */
export function documentMetadataOptions(
  documentId: string
): SoupItemsQueryOptions {
  return {
    ignoresNotifications: true,
    graphqlCacheFirstEntities: [{ entityType: 'DOCUMENT', entityId: documentId }],
  };
}
