import { crmAccessAllowed } from '@service-storage/crm-access-authority';

export { materializeCachedGraphqlCrmCompanies } from './queries/graphql';

import { debouncedDependent } from '@core/util/debounce';
import { queryReadyGate } from '@queries/gate';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { validateSearchServiceText } from '@queries/soup/search';
import { useInfiniteQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { crmCompanySearchQueryOptions } from './queries/company-search';
import { useQuickAccessCrmCompaniesQuery as createSuggestions } from './queries/company-suggestions';
export function useQuickAccessCrmCompaniesQuery() {
  return createSuggestions(useSoupAstItemsQuery, crmAccessAllowed);
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

const COMPANY_PICKER_SEARCH_DEBOUNCE_MS = 250;

/**
 * Companies the search service matches for what a picker's field holds,
 * once typing settles: a picker that must reach beyond the companies Quick
 * Access keeps.
 */
export function useCrmCompanyPickerSearch(search: Accessor<string>) {
  const query = debouncedDependent(
    () => search().trim(),
    COMPANY_PICKER_SEARCH_DEBOUNCE_MS
  );
  const enabled = () =>
    crmAccessAllowed() &&
    query().length > 0 &&
    validateSearchServiceText(query());
  const source = useCrmCompanySearchSource(query, enabled);
  // Until typing settles, the pages answer an earlier search: list none of
  // them, and count the wait as loading.
  const settling = () => search().trim() !== query();
  return {
    companies: () => (settling() ? [] : source.companies()),
    isLoading: () =>
      search().trim().length > 0 &&
      (settling() || (enabled() && source.isLoading())),
    hasMore: source.hasMore,
    isLoadingMore: source.isLoadingMore,
    loadMore: source.loadMore,
    error: () => source.error(),
    retry: source.retry,
  };
}
