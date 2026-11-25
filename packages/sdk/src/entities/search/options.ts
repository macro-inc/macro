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
import { type IterationOptions, iterate, paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

type Hit = UnifiedSearchResponseItem;

export type SearchOn = 'name' | 'content' | 'name_content';

const DEFAULT_SEARCH_PAGE_SIZE = 50;

export interface SearchOpts extends IterationOptions {
  searchOn?: SearchOn;
  pageSize?: number;
}

/**
 * The time zone a search's typed dates (`after:2025/01/31`) are read in: the
 * one asked for, else this runtime's.
 */
export function searchTimeZone(timeZone?: string): string | undefined {
  return timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Build a `search(client, query, opts?)` function for one entity type: unified
 * search hits narrowed to `type`, each mapped through `make`.
 * Most relevant first, auto-paginated; `maxItems` caps the total.
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
  return (client, query, searchOpts) =>
    iterate(
      `${type} search`,
      searchOpts,
      { searchOn: true, pageSize: true },
      () => pages(client, query, searchOpts),
    );

  function pages(
    client: MacroClient,
    query: string,
    searchOpts: SearchOpts | undefined,
  ): AsyncGenerator<T> {
    const searchOn = searchOpts?.searchOn ?? 'name_content';
    const pageSize = searchOpts?.pageSize ?? DEFAULT_SEARCH_PAGE_SIZE;
    const timeZone = searchTimeZone();
    return paginate(async (cursor) => {
      const { results, next_cursor } = unwrap(
        await client.search.unifiedSearch({
          body: {
            query,
            match_type: 'partial',
            search_on: searchOn,
            ...(filters ? { filters } : {}),
            ...(includeCrm ? { include_crm: true } : {}),
            ...(timeZone ? { time_zone: timeZone } : {}),
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
