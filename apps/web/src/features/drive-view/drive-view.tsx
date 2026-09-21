import { listOwnedSlotName } from '@app/components/list';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import {
  type FacetSelection,
  normalizeFacetSelection,
  serializeFacetSelection,
  useSoupListNavigationHotkeys,
} from '@app/features/soup';
import {
  createSearchParams,
  type SetSearchParams,
  type SplitNavigateOptions,
  useNavigate,
  useParams,
} from '@app/split-router';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useEntryState } from '@components/app/split-layout/entry-state';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { ListEntityMetadataQueryProvider } from '@entity';
import { useTagSets, useTagSetsReady } from '@property/tags/tag-sets-context';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  type Setter,
  Suspense,
} from 'solid-js';
import { DriveProvider } from './context/drive-context';
import { driveLocationLabel } from './core/location-label';
import type { DriveLocation, DriveState } from './core/types';
import {
  DriveDetailNavigationProvider,
  useDriveDetailNavigation,
} from './drive-detail-navigation';
import { createDriveHostActions } from './drive-host-actions';
import {
  createDriveList,
  parseDriveListSnapshot,
} from './primitives/drive-list';
import {
  type DriveDocumentRoute,
  type DriveRouteParams,
  driveLocationFromParams,
  drivePath,
} from './primitives/drive-route';
import {
  type DriveSearchParams,
  driveSearchParamsOptions,
  serializeDriveSearchParams,
} from './primitives/drive-search-params';
import { createDriveState } from './primitives/drive-state';
import { createDriveDataSource } from './queries/drive-data-source';
import { createDriveSidebarSource } from './queries/drive-sidebar-source';
import { DriveLoading, DriveWorkspace } from './views/drive-workspace';

export type DriveViewProps = { initialFacets?: FacetSelection };

type DriveNavigationOptions = Pick<
  SplitNavigateOptions<unknown>,
  'replace' | 'target'
>;

type DriveCompositionProps = DriveViewProps & {
  location: Accessor<DriveLocation>;
  routeSearch: DriveSearchParams;
  routedFacets: Accessor<FacetSelection>;
  setRouteSearch: SetSearchParams<DriveSearchParams>;
  navigateLocation: (
    location: DriveLocation,
    search: DriveSearchParams,
    options?: DriveNavigationOptions
  ) => void;
};

function sameLocation(left: DriveLocation, right: DriveLocation): boolean {
  if (left.kind === 'folder' && right.kind === 'folder') {
    return left.id === right.id;
  }

  return left.kind === 'tab' && right.kind === 'tab' && left.tab === right.tab;
}

function routeSearchFromState(state: DriveState): DriveSearchParams {
  return {
    scope: state.scope,
    sort: state.sort,
    facets: normalizeFacetSelection(state.facets),
  };
}

function sameRouteSearch(
  left: DriveSearchParams,
  right: DriveSearchParams
): boolean {
  return (
    left.scope === right.scope &&
    left.sort === right.sort &&
    serializeFacetSelection(left.facets) ===
      serializeFacetSelection(right.facets)
  );
}

/** The only place that constructs production sources and app capabilities. */
function DriveComposition(props: DriveCompositionProps) {
  const panel = useSplitPanelOrThrow();

  const navigation = useDriveDetailNavigation();

  const userId = useUserId();

  const notificationSource = useGlobalNotificationSource();

  const tagSets = useTagSets();

  const tagSetsReady = useTagSetsReady();

  const [savedValue, setSavedValue] = useEntryState<DriveState>(
    'drive.view.v2',
    {
      default: {
        location: props.location(),
        scope: props.routeSearch.scope,
        sort: props.routeSearch.sort,
        search: '',
        facets: props.routedFacets(),
        expandedFolderIds: [],
        favoritesOpen: true,
        rootOpen: true,
        tagsOpen: true,
      },
    }
  );

  const value = (): DriveState => ({
    ...savedValue(),
    location: props.location(),
    scope: props.routeSearch.scope,
    sort: props.routeSearch.sort,
    facets: props.routedFacets(),
  });

  const commitRouteState = (
    next: DriveState,
    previous: DriveState,
    options: DriveNavigationOptions = {}
  ) => {
    const nextSearch = routeSearchFromState(next);
    const previousSearch = routeSearchFromState(previous);

    if (!sameLocation(next.location, previous.location)) {
      props.navigateLocation(next.location, nextSearch, options);
      return;
    }

    if (!sameRouteSearch(nextSearch, previousSearch)) {
      props.setRouteSearch(nextSearch, {
        mode: 'replace',
        history: options.replace ? 'replace' : 'push',
      });
    }
  };

  const setValue: Setter<DriveState> = (update) => {
    const previous = value();
    const next = typeof update === 'function' ? update(previous) : update;

    setSavedValue(() => next);
    commitRouteState(next, previous);

    return next;
  };

  const sidebar = createDriveSidebarSource();

  const source = withSplitPanelOwner(listOwnedSlotName('data-source'), () =>
    createDriveDataSource({
      selection: value,
      userId,
      tagSets,
      tagSetsReady,
      notificationSource,
    })
  );

  const actions = createDriveHostActions({
    projectId: () => state.projectId(),

    selectFolder: (id) => state.selectFolder(id),
  });

  const list = withSplitPanelOwner(listOwnedSlotName('controller'), () =>
    createDriveList({
      source,
      initial: parseDriveListSnapshot(
        panel.handle.content().state?.['drive.listState']
      ),

      onActivate: (row, metadata) =>
        actions.openEntity(
          row.entity,
          metadata?.event,
          undefined,
          metadata?.newSplit
        ),
    })
  );

  const state = createDriveState({
    state: value,
    setState: setValue,
    folders: sidebar.folders,
    list,

    showList: () => {
      navigation.clear();
      panel.handle.resetPreview();
    },
  });

  createEffect(
    on(
      () =>
        JSON.stringify([
          props.location(),
          props.routeSearch.scope,
          props.routeSearch.sort,
          serializeFacetSelection(props.routedFacets()),
        ]),
      () => {
        const current = savedValue();
        const locationChanged = !sameLocation(
          current.location,
          props.location()
        );
        const selectionChanged =
          locationChanged ||
          !sameRouteSearch(routeSearchFromState(current), {
            scope: props.routeSearch.scope,
            sort: props.routeSearch.sort,
            facets: props.routedFacets(),
          });

        if (!selectionChanged) return;

        setSavedValue({
          ...current,
          location: props.location(),
          scope: props.routeSearch.scope,
          sort: props.routeSearch.sort,
          search: locationChanged ? '' : current.search,
          facets: props.routedFacets(),
        });

        if (selectionChanged) list.reset();
        if (locationChanged) panel.handle.resetPreview();
      },
      { defer: true }
    )
  );

  createEffect(
    on(
      () => {
        const location = value().location;

        if (
          sidebar.foldersLoading() ||
          sidebar.foldersError() ||
          location.kind !== 'folder' ||
          !location.id
        ) {
          return;
        }

        return sidebar.folders().some((folder) => folder.id === location.id)
          ? undefined
          : location.id;
      },
      (unavailableFolderId) => {
        if (!unavailableFolderId) return;

        const previous = value();
        const next: DriveState = {
          ...previous,
          location: { kind: 'folder', id: null },
          scope: 'default',
          search: '',
          facets: {},
        };

        setSavedValue(next);
        commitRouteState(next, previous, { replace: true });
        panel.handle.resetPreview();
        toast.alert('Folder unavailable', {
          subtext: 'It may have moved, been deleted, or no longer be shared.',
        });
      }
    )
  );

  onCleanup(
    panel.handle.registerEntryStateCaptor('drive.returnLabel', () =>
      driveLocationLabel(value().location, sidebar.folders())
    )
  );

  onCleanup(
    panel.handle.registerEntryStateCaptor('drive.listState', list.snapshot)
  );

  withSplitPanelOwner(listOwnedSlotName('navigation-hotkeys'), () => {
    useSoupListNavigationHotkeys({
      splitHotkeyScope: panel.splitHotkeyScope,
      viewId: 'documents',
      dataSource: source,
      controller: list.controller,
      handle: panel.handle,

      openEntityInSplit: (entity, options) => {
        void openEntityInSplitFromUnifiedList(entity, {
          splitHandle: panel.handle,
          ...options,
        });
      },
    });
  });

  onMount(() => panel.handle.setDisplayName('Drive'));

  return (
    <DriveProvider value={{ state, source, list, sidebar, actions }}>
      <DriveWorkspace />
    </DriveProvider>
  );
}

export function DriveView(props: DriveViewProps) {
  const params = useParams<DriveRouteParams>();

  const navigate = useNavigate();

  const [routeSearch, setRouteSearch] = createSearchParams(
    driveSearchParamsOptions
  );

  const location = createMemo(() => driveLocationFromParams(params));

  const initialFacets = normalizeFacetSelection(props.initialFacets);
  const [useInitialFacets, setUseInitialFacets] = createSignal(
    Object.keys(routeSearch.facets).length === 0 &&
      Object.keys(initialFacets).length > 0
  );
  const routedFacets = () =>
    useInitialFacets() ? initialFacets : routeSearch.facets;

  onMount(() => {
    if (!useInitialFacets()) return;

    batch(() => {
      setRouteSearch({ facets: initialFacets }, { history: 'replace' });
      setUseInitialFacets(false);
    });
  });

  const navigateRoute = (
    nextLocation: DriveLocation,
    nextDocument?: DriveDocumentRoute,
    options: SplitNavigateOptions<unknown> = {}
  ) => navigate(drivePath(nextLocation, nextDocument), options);

  return (
    <DriveDetailNavigationProvider location={location}>
      <ListEntityMetadataQueryProvider>
        <Suspense fallback={<DriveLoading />}>
          <DriveComposition
            {...props}
            location={location}
            routeSearch={routeSearch}
            routedFacets={routedFacets}
            setRouteSearch={setRouteSearch}
            navigateLocation={(nextLocation, search, options = {}) =>
              navigateRoute(nextLocation, undefined, {
                ...options,
                search: { drive: serializeDriveSearchParams(search) },
              })
            }
          />
        </Suspense>
      </ListEntityMetadataQueryProvider>
    </DriveDetailNavigationProvider>
  );
}
