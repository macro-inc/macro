import { crmAccessAllowed } from '@service-storage/crm-access-authority';

export { materializeCachedGraphqlCrmCompanies } from './queries/graphql';

import { queryReadyGate } from '@queries/gate';
import { useSoupItemsQuery } from '@queries/soup/items';
import { useInfiniteQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { crmCompanySearchQueryOptions } from './queries/company-search';
import { useQuickAccessCrmCompaniesQuery as createSuggestions } from './queries/company-suggestions';
export function useQuickAccessCrmCompaniesQuery() {
  return createSuggestions(useSoupItemsQuery, crmAccessAllowed);
}

/** Companies the search service matches by name or domain, beyond the
 * companies Quick Access holds. */
export function useCrmCompanySearchSource(
  search: Accessor<string>,
  enabled: Accessor<boolean>
) {
  const query = useInfiniteQuery(() =>
    crmCompanySearchQueryOptions(search(), enabled())
  );
  return {
    companies: () => (queryReadyGate(query) ? query.data : []),
    isLoading: () => query.isLoading,
    // A failed page ends paging until Retry, so scrolling cannot repeat it.
    hasMore: () => query.hasNextPage && !query.isFetchNextPageError,
    isLoadingMore: () => query.isFetchingNextPage,
    loadMore: async () => {
      await query.fetchNextPage();
    },
    error: () => query.error ?? undefined,
    // A failed later page is the next one to read; a failed first page is
    // read from the start.
    retry: async () => {
      if (query.isFetchNextPageError) await query.fetchNextPage();
      else await query.refetch();
    },
  };
}
