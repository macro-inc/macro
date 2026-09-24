import { buildFlatSoupRows } from '@app/features/soup/collection/rows';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import {
  createTagFacetContext,
  tagFacetReady,
  testFacets,
} from '@app/features/soup/filters';
import {
  createSearchState,
  useOptionalSearchContext,
} from '@app/features/soup/search';
import { enableSnippets, isFeatureEnabled } from '@core/constant/featureFlags';
import type { EntityData } from '@entity';
import type { NotificationSource } from '@notifications';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import {
  isDisplayableSoupItem,
  mapApiSoupItemToEntity,
} from '@queries/soup/transform-utils';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { type Accessor, createMemo } from 'solid-js';
import type { DriveListSource, DriveSelection } from '../context/drive-source';
import { DRIVE_FACETS } from '../filters/drive-facets';
import { buildDriveQuery } from './drive-query';
import {
  driveEntityMatchesLocation,
  orderDriveEntities,
} from './drive-results';
import { buildDriveSearchRequest } from './drive-search';

/** Query, local/service search and row assembly owned by Drive. */
export function createDriveDataSource(options: {
  selection: Accessor<DriveSelection>;
  userId: Accessor<string | undefined>;
  tagSets: Accessor<readonly TagSetResponse[]>;
  tagSetsReady: Accessor<boolean>;
  notificationSource: NotificationSource;
}): DriveListSource {
  const { selection, userId, notificationSource } = options;

  const searchContext = useOptionalSearchContext();

  const facetContext = createMemo(() =>
    createTagFacetContext(options.tagSets())
  );

  const facetsReady = () =>
    tagFacetReady(selection().facets, options.tagSetsReady());

  const query = useSoupAstItemsQuery(
    () =>
      buildDriveQuery({
        selection: selection(),
        userId: userId(),
        facetContext: facetContext(),
        snippetsEnabled: isFeatureEnabled(enableSnippets),
      }),
    () => {
      // Bind optimistic cache membership to this query, not a later location.
      const current = selection();

      const viewer = userId();

      const context = facetContext();

      return {
        enabled: Boolean(viewer) && facetsReady() && !current.search.trim(),
        // Folder contents mix email with indexed project members. Seed the
        // latter locally without narrowing the authoritative server request.
        graphqlLocalReconciliation:
          current.location.kind === 'folder' && current.location.id
            ? 'without-email'
            : undefined,
        meta: {
          // REST inserts omit attachment status. Let a scoped server refetch
          // admit them rather than inserting an unverifiable document.
          insertFilter: (item) =>
            current.scope === 'all' || item.tag !== 'document',

          itemFilter: (item) => {
            if (!isDisplayableSoupItem(item)) return false;

            const entity = mapApiSoupItemToEntity(item);

            if (!driveEntityMatchesLocation(entity, current, viewer))
              return false;

            return testFacets(current.facets, DRIVE_FACETS, entity, context);
          },
        },
      };
    }
  );

  // Cold REST data suspends; keep the shell and its controls available.
  const queryData = () => (query.isLoading ? undefined : query.data);

  const matchesFacets = (entity: EntityData) =>
    testFacets(selection().facets, DRIVE_FACETS, entity, facetContext());

  const localPool = createMemo(() => {
    const attachmentScoped = selection().scope !== 'all';

    const admittedDocuments = new Set<string>();

    if (attachmentScoped && !query.isPlaceholderData) {
      for (const entity of queryData()?.entities ?? []) {
        if (entity.type === 'document') admittedDocuments.add(entity.id);
      }
    }

    return (searchContext?.entityPool() ?? []).filter(({ data: entity }) => {
      if (!driveEntityMatchesLocation(entity, selection(), userId()))
        return false;
      if (!matchesFacets(entity)) return false;
      if (entity.type !== 'document' || !attachmentScoped) return true;

      // Local documents lack attachment status: trust only membership already
      // established by this exact scoped query, never another view's cache.
      return admittedDocuments.has(entity.id);
    });
  });

  const search = createSearchState({
    text: () => selection().search,

    enabled: facetsReady,
    localPool,

    buildRequest: (request) =>
      buildDriveSearchRequest({
        ...request,
        selection: selection(),
        userId: userId(),
        facetContext: facetContext(),
      }),
  });

  const rawEntities = createMemo<EntityData[]>((previous) => {
    if (!search.isSearching()) {
      if (query.isPlaceholderData) return [];

      return queryData()?.entities ?? [];
    }

    const results = search.data();

    if (results.length === 0 && search.isLocalSearchSettling()) return previous;

    return results;
  }, []);

  const entities = createMemo(() => {
    if (!facetsReady()) return [];

    const matching = rawEntities().filter((entity) => {
      const matchesLocation = driveEntityMatchesLocation(
        entity,
        selection(),
        userId(),
        {
          trustFolderMembership: true,
        }
      );

      return matchesLocation && matchesFacets(entity);
    });

    return orderDriveEntities(matching, selection(), search.featuredIds()).map(
      (entity) => withEntityNotifications(entity, notificationSource)
    );
  });

  const items = createMemo(() => buildFlatSoupRows(entities()));

  const isFetching = () => {
    if (search.isSearching())
      return search.isFetching() || search.isLocalSearchSettling();

    return query.isFetching;
  };

  const hasMore = () =>
    search.isSearching() ? search.hasNextPage() : query.hasNextPage;

  const error = () => {
    if (search.isSearching()) return search.error();

    return query.error ?? undefined;
  };

  return {
    items,

    isLoading: () => {
      if (items().length > 0) return false;
      if (!facetsReady()) return true;
      if (search.isSearching()) return isFetching();

      return query.isLoading || query.isFetching;
    },

    isFetching,

    error,

    hasData: () => {
      if (search.isSearching())
        return items().length > 0 || (!isFetching() && !error());

      return queryData() !== undefined && !query.isPlaceholderData;
    },

    hasMore,

    isLoadingMore: () =>
      search.isSearching()
        ? search.isFetchingNextPage()
        : query.isFetchingNextPage,

    loadMore: async () => {
      if (isFetching() || !hasMore()) return;

      if (search.isSearching()) await search.fetchNextPage();
      else await query.fetchNextPage();

      // Both transports can resolve failed page requests instead of rejecting.
      const failure = error();

      if (failure) throw failure;
    },

    refresh: async () => {
      if (search.isSearching()) await search.refresh();
      else await query.refresh();
    },

    featuredIds: search.featuredIds,

    deferInteractions: () => {
      if (search.isSearching()) return search.isLocalSearchSettling();

      return query.isFetching && query.isPlaceholderData;
    },
  };
}
