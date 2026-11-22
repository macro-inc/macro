import { debouncedDependent } from '@core/util/debounce';
import { throwOnErr } from '@core/util/result';
import { queryReadyGate } from '@queries/gate';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type {
  CatalogApp,
  CatalogPage,
} from '@service-cognition/generated/schemas';
import {
  type InfiniteData,
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/solid-query';
import { type Accessor, createSignal } from 'solid-js';
import { connectorKeys } from './keys';

/** How long typing settles before the catalog is re-queried. */
const SEARCH_DEBOUNCE_MS = 250;

// Serve the previous search's results (or nothing) instead of suspending:
// first load must not block a page on the directory, and keystrokes must not
// blank the list while refetching.
function catalogPlaceholder(
  previous: InfiniteData<CatalogPage, string | undefined> | undefined
) {
  return previous ?? { pages: [], pageParams: [] };
}

async function fetchCatalogPage(search: string, cursor: string | undefined) {
  return await throwOnErr(
    async () =>
      await cognitionApiServiceClient.browseConnectorCatalog({
        search: search || undefined,
        cursor,
      })
  );
}

function nextCatalogCursor(page: CatalogPage) {
  return page.nextCursor ?? undefined;
}

// Cached callbacks only close over the trimmed search string.
function connectorCatalogQueryOptions(search: string) {
  return infiniteQueryOptions({
    queryKey: connectorKeys.catalog(search).queryKey,
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      await fetchCatalogPage(search, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCatalogCursor,
    staleTime: 5 * 60 * 1000,
    placeholderData: catalogPlaceholder,
  });
}

/** Browse or search the apps the user can connect, most popular first. */
function useConnectorCatalogQuery(search: () => string) {
  return useInfiniteQuery(() => connectorCatalogQueryOptions(search().trim()));
}

async function fetchIconPage() {
  return await throwOnErr(
    async () =>
      await cognitionApiServiceClient.browseConnectorCatalog({ limit: 50 })
  );
}

function iconsBySlug(page: CatalogPage) {
  return new Map(page.apps.map((app) => [app.slug, app.iconUrl]));
}

function connectorCatalogIconsQueryOptions() {
  return queryOptions({
    queryKey: connectorKeys.catalogIcons.queryKey,
    queryFn: fetchIconPage,
    select: iconsBySlug,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * App logos by slug, from one full-size catalog page: connectors carry only a
 * slug. An app outside the most popular ones keeps its fallback icon.
 */
export function useConnectorCatalogIconsQuery() {
  return useQuery(connectorCatalogIconsQueryOptions);
}

/**
 * Debounced search over the connector catalog, shared by every surface that
 * offers apps to connect. Holds the query and the input/committed search
 * split; the caller owns presentation. `exclude` drops apps the surface has
 * already accounted for, by slug.
 */
export function createConnectorCatalogSearch(
  exclude: Accessor<ReadonlySet<string>>
) {
  const [searchInput, setSearchInput] = createSignal('');
  const onSearchInput = (value: string) => setSearchInput(value);
  const search = debouncedDependent(searchInput, SEARCH_DEBOUNCE_MS);

  const query = useConnectorCatalogQuery(search);

  const entries = (): CatalogApp[] => {
    if (!queryReadyGate(query)) return [];
    return (query.data?.pages ?? [])
      .flatMap((page) => page.apps)
      .filter((app) => !exclude().has(app.slug));
  };

  return { searchInput, onSearchInput, search, query, entries };
}

export type ConnectorCatalogSearch = ReturnType<
  typeof createConnectorCatalogSearch
>;
