import { createPipedreamCatalogSearch } from '@core/pipedream/catalog';
import { fireAndForget } from '@core/util/fireAndForget';
import { NATIVE_GITHUB_TOOL, ONBOARDING_FEATURED_TOOLS } from '../core/tools';

/** Stable featured metadata plus one paginated, searchable live directory. */
export function createOnboardingToolCatalog() {
  const catalog = createPipedreamCatalogSearch(
    () => new Set<string>(['github'])
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
          .filter((entry) => entry.app_slug !== NATIVE_GITHUB_TOOL.slug)
          .map((entry) => ({
            slug: entry.app_slug,
            name: entry.display_name,
            iconUrl: entry.icon_url ?? null,
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
