import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { searchClient } from '@service-search/client';
import type {
  DatabaseRowSearchResponseItem,
  UnifiedSearchRequest,
  UnifiedSearchResponse,
} from '@service-search/generated/models';
import { queryOptions } from '@tanstack/solid-query';
import type { DatabaseRowTarget } from '../open-row';
import { databaseRowSearchKeys } from './keys';

export const DATABASE_ROW_SEARCH_PAGE_SIZE = 6;

/** A row a search found, with where it lives. */
export type DatabaseRowMatch = DatabaseRowTarget & {
  databaseName: string;
  tableName: string;
  /** Plain text; empty when the row's title cell is. */
  title: string;
  /** A matching cell's passage, matched words in `<macro_em>` tags. */
  snippet?: string;
};

export function toDatabaseRowMatch(
  item: DatabaseRowSearchResponseItem
): DatabaseRowMatch {
  return {
    databaseId: item.database_id,
    tableId: item.table_id,
    rowId: item.row_id,
    databaseName: item.database_name,
    tableName: item.table_name,
    title: item.title,
    snippet: item.snippet ?? undefined,
  };
}

/** Database rows only: every other kind is excluded by its nil id filter. */
export function databaseRowSearchRequest(term: string): UnifiedSearchRequest {
  return {
    query: term,
    match_type: 'partial',
    search_on: 'name_content',
    include_database_rows: true,
    filters: QUERY_FILTERS_BASE,
  };
}

function selectRows(page: UnifiedSearchResponse): DatabaseRowMatch[] {
  return page.results.flatMap((result) =>
    result.type === 'databaseRow' ? [toDatabaseRowMatch(result)] : []
  );
}

/** The first rows matching `term`. Keyed by the term, so an answer to an
 * older term never stands for a newer one. */
export function databaseRowSearchQueryOptions(term: string, enabled: boolean) {
  const pageSize = DATABASE_ROW_SEARCH_PAGE_SIZE;
  return queryOptions({
    queryKey: databaseRowSearchKeys.term(term, pageSize).queryKey,
    queryFn: ({ signal }) =>
      Telemetry.span('database.row_search', async (span) => {
        span.setAttr('search.source', 'server');
        span.setAttr('search.query_length', term.length);
        span.setAttr('search.limit', pageSize);
        const page = await throwOnErr(
          async () =>
            await searchClient.search(
              {
                params: { page_size: pageSize },
                request: databaseRowSearchRequest(term),
              },
              { signal }
            )
        );
        span.setAttr('search.result_count', page.results.length);
        return page;
      }),
    select: selectRows,
    enabled,
    // Access can be revoked at any moment and the server checks it on every
    // search, so a row is never shown from an earlier answer.
    staleTime: 0,
    gcTime: 0,
    meta: { normalize: false },
  });
}
