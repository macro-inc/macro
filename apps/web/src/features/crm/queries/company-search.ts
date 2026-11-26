import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { throwOnErr } from '@core/util/result';
import { type CrmCompanyEntity, isCrmCompanyEntity } from '@entity';
import { Telemetry } from '@macro-inc/observability';
import { soupKeys } from '@queries/soup/keys';
import { createSearchResponseItemMapper } from '@queries/soup/transform-utils';
import { searchClient } from '@service-search/client';
import type { UnifiedSearchRequest } from '@service-search/generated/models';
import { infiniteQueryOptions } from '@tanstack/solid-query';

const COMPANY_SEARCH_PAGE_SIZE = 50;

/** The search service's name and domain match over the viewer's team CRM
 * companies, every other entity kind left out; archived companies stay out,
 * as they do in Quick Access. */
function companySearchBody(term: string): UnifiedSearchRequest {
  return {
    query: term,
    match_type: 'partial',
    search_on: 'name',
    include_crm: true,
    filters: {
      ...QUERY_FILTERS_BASE,
      crm_company_filters: { hidden: false },
    },
  };
}

/** Pages of companies matching `term`. The key is the unified search key, so
 * company visibility changes refresh it with the other CRM searches. */
export function crmCompanySearchQueryOptions(term: string, enabled: boolean) {
  const params = { page_size: COMPANY_SEARCH_PAGE_SIZE };
  const body = companySearchBody(term);
  const mapResult = createSearchResponseItemMapper([]);
  return infiniteQueryOptions({
    queryKey: soupKeys.search({ params, body }).queryKey,
    queryFn: ({ pageParam, signal }) =>
      Telemetry.span('crm.company_search', async (span) => {
        span.setAttr('search.source', 'server');
        span.setAttr('search.query_length', term.length);
        span.setAttr('search.continuation', pageParam.cursor !== null);
        span.setAttr('search.limit', COMPANY_SEARCH_PAGE_SIZE);
        const page = await throwOnErr(
          async () =>
            await searchClient.search(
              { params: pageParam, request: body },
              { signal }
            )
        );
        span.setAttr('search.result_count', page.results.length);
        span.setAttr('search.has_more', !!page.next_cursor);
        return page;
      }),
    initialPageParam: {
      cursor: null as string | null,
      page_size: COMPANY_SEARCH_PAGE_SIZE,
    },
    getNextPageParam: (lastPage) =>
      lastPage.next_cursor
        ? { cursor: lastPage.next_cursor, page_size: COMPANY_SEARCH_PAGE_SIZE }
        : undefined,
    select: (data): CrmCompanyEntity[] =>
      data.pages.flatMap((page) =>
        page.results.flatMap((result) =>
          mapResult(result, term).flatMap((entity) =>
            entity && isCrmCompanyEntity(entity) && !entity.hidden
              ? [entity]
              : []
          )
        )
      ),
    enabled,
    meta: { normalize: false },
  });
}
