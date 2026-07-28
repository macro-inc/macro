import type {
  EntityFilters,
  UnifiedSearchResponseItem,
} from '../../generated/search/types.gen';
import { paginate, unwrap } from '../utils';
import type { MacroClient } from '../utils/client';

type Hit = UnifiedSearchResponseItem;

export type SearchOn = 'name' | 'content' | 'name_content';

const DEFAULT_SEARCH_PAGE_SIZE = 50;

export interface SearchOpts {
  searchOn?: SearchOn;
  pageSize?: number;
}

/**
 * Build a `search(client, query, opts?)` function for one entity type: unified
 * search hits narrowed to `type`, each mapped through `make`.
 * Most relevant first, auto-paginated.
 */
export function entitySearch<T, K extends Hit['type']>(opts: {
  filters?: EntityFilters;
  type: K;
  make: (client: MacroClient, hit: Extract<Hit, { type: K }>) => T;
  /** Opt in to CRM results (off by default server-side; required for company hits). */
  includeCrm?: boolean;
}): (
  client: MacroClient,
  query: string,
  searchOpts?: SearchOpts,
) => AsyncGenerator<T> {
  const { filters, type, make, includeCrm } = opts;
  return (client, query, searchOpts) => {
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
  };
}
