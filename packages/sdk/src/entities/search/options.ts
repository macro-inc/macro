/**
 * Per-type search: the options every entity's own `search()` takes, and the
 * helper that builds one. Cross-type search is `macro.search`.
 *
 * @packageDocumentation
 */

import type {
  EntityFilters,
  UnifiedSearchResponseItem,
} from '../../../generated/search/types.gen';
import {
  type IterationOptions,
  iterate,
  MacroError,
  paginate,
  unwrap,
} from '../../utils';
import type { MacroClient } from '../../utils/client';

type Hit = UnifiedSearchResponseItem;

export type SearchOn = 'name' | 'content' | 'name_content';

const DEFAULT_SEARCH_PAGE_SIZE = 50;

export interface SearchOpts extends IterationOptions {
  searchOn?: SearchOn;
  pageSize?: number;
}

/**
 * Build a `search(client, query, opts?)` function for one entity type: unified
 * search hits narrowed to `type`, each mapped through `make`.
 * Most relevant first, auto-paginated; `maxItems` caps the total. A query
 * with no word to search for throws before any request, as the server
 * refuses it, naming `listWith` when given.
 */
export function entitySearch<T, K extends Hit['type']>(opts: {
  filters?: EntityFilters;
  type: K;
  make: (client: MacroClient, hit: Extract<Hit, { type: K }>) => T;
  /** Opt in to CRM results (off by default server-side; required for company hits). */
  includeCrm?: boolean;
  /** The method that lists these items without a query, named when one has no word. */
  listWith?: string;
}): (
  client: MacroClient,
  query: string,
  searchOpts?: SearchOpts,
) => AsyncGenerator<T> {
  const { filters, type, make, includeCrm, listWith } = opts;
  return (client, query, searchOpts) => {
    // As the server's `trimmed_query`: whitespace and double quotes are no word.
    if (typeof query !== 'string' || /^[\s"]*$/.test(query))
      throw new MacroError(
        listWith
          ? `Search needs a word to look for; to list without one, use ${listWith}.`
          : 'Search needs a word to look for.',
      );
    return iterate(
      `${type} search`,
      searchOpts,
      { searchOn: true, pageSize: true },
      () => pages(client, query, searchOpts),
    );
  };

  function pages(
    client: MacroClient,
    query: string,
    searchOpts: SearchOpts | undefined,
  ): AsyncGenerator<T> {
    const searchOn = searchOpts?.searchOn ?? 'name_content';
    const pageSize = searchOpts?.pageSize ?? DEFAULT_SEARCH_PAGE_SIZE;
    return paginate(async (cursor) => {
      const { results, next_cursor } = unwrap(
        await client.search.unifiedSearch({
          body: {
            query,
            match_type: 'partial',
            search_on: searchOn,
            ...(filters ? { filters } : {}),
            ...(includeCrm ? { include_crm: true } : {}),
          },
          query: {
            page_size: pageSize,
            ...(cursor ? { cursor } : {}),
          },
        }),
      );
      const hits = results.filter(
        (r): r is Extract<Hit, { type: K }> => r.type === type,
      );
      return {
        items: hits.map((h) => make(client, h)),
        nextCursor: next_cursor,
      };
    });
  }
}
