import { fireAndForget } from '@core/util/fireAndForget';
import { createConnectorCatalogSearch } from '@queries/connectors';
import { NATIVE_GITHUB_TOOL, ONBOARDING_FEATURED_TOOLS } from '../core/tools';

/** Stable featured metadata plus one paginated, searchable live directory. */
export function createOnboardingToolCatalog() {
  const catalog = createConnectorCatalogSearch(
    () => new Set<string>([NATIVE_GITHUB_TOOL.slug])
  );
  return {
    search: catalog.searchInput,
    setSearch: catalog.onSearchInput,
    entries: () => {
      const search = catalog.search().trim().toLowerCase();
      const featured = search
        ? ONBOARDING_FEATURED_TOOLS.filter((tool) =>
            tool.name.toLowerCase().includes(search)
          )
        : ONBOARDING_FEATURED_TOOLS;
      return [
        ...featured,
        ...catalog
          .entries()
          .filter((entry) => entry.slug !== NATIVE_GITHUB_TOOL.slug)
          .map((entry) => ({
            slug: entry.slug,
            name: entry.name,
            iconUrl: entry.iconUrl ?? null,
          })),
      ];
    },
    fetching: () => catalog.query.isFetching,
    failed: () => catalog.query.isError,
    hasMore: () => catalog.query.hasNextPage,
    loadMore: () => fireAndForget(catalog.query.fetchNextPage(), 'onboarding'),
    retry: () => fireAndForget(catalog.query.refetch(), 'onboarding'),
  };
}
