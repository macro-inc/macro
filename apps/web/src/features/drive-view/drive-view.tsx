import { listOwnedSlotName } from '@app/components/list';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import {
  type FacetSelection,
  useSoupListNavigationHotkeys,
} from '@app/features/soup';
import { ViewTour } from '@app/features/tours/ViewTour';
import type { TutorialId } from '@app/features/video-tutorials';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { usePending } from '@app/observability/flow';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { enableDriveRedesign } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { createOpenTracker } from '@core/internal/open-tracker';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type EntityData,
  type KnownFolder,
  KnownFoldersProvider,
  ListEntityMetadataQueryProvider,
} from '@entity';
import { markRowNotificationsSeenOnOpen } from '@notifications/mark-row-seen';
import { useTagSets, useTagSetsReady } from '@property/tags/tag-sets-context';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { DriveProvider } from './context/drive-context';
import { DriveRedesignProvider } from './context/drive-redesign-context';
import { driveLocationLabel } from './core/location-label';
import {
  DriveDetailNavigationProvider,
  useDriveDetailNavigation,
} from './drive-detail-navigation';
import { createDriveHostActions } from './drive-host-actions';
import { DriveRedesignEntry } from './drive-redesign-entry';
import { createDriveRedesignHost } from './drive-redesign-host';
import { createDriveInlineEdit } from './primitives/drive-inline-edit';
import { createDriveInspector } from './primitives/drive-inspector';
import {
  createDriveList,
  parseDriveListSnapshot,
} from './primitives/drive-list';
import { createOptimisticFoldersController } from './primitives/drive-optimistic-folders';
import {
  createDriveRouteState,
  createDriveViewState,
  type DriveRouteState,
} from './primitives/drive-route-state';
import { createDriveState } from './primitives/drive-state';
import { createDriveViewPreferences } from './primitives/drive-view-preferences';
import { useDriveAgents } from './primitives/use-drive-agents';
import { createDriveDataSource } from './queries/drive-data-source';
import { createDriveFolderContentsSource } from './queries/drive-folder-contents';
import { createDriveSidebarSource } from './queries/drive-sidebar-source';
import { createDriveTrashSource } from './queries/drive-trash';
import { documentsTour } from './tour';
import { DriveLoading, DriveWorkspace } from './views/drive-workspace';
import { SignedOutDriveWorkspace } from './views/signed-out-drive-workspace';

export type DriveViewProps = { initialFacets?: FacetSelection };

/** Constructs production sources and injects app capabilities into the workspace. */
function DriveComposition(props: { route: DriveRouteState }) {
  const panel = useSplitPanelOrThrow();
  const navigation = useDriveDetailNavigation();
  const userId = useUserId();
  // Docs, and the Blocks listed in Drive that are rolled out to this person.
  const tutorials = () => {
    const ids: TutorialId[] = ['docs', 'spreadsheets', 'databases'];

    return ids;
  };
  const notificationSource = useGlobalNotificationSource();
  const tagSets = useTagSets();
  const tagSetsReady = useTagSetsReady();
  const redesignFlag = useFeatureFlag(enableDriveRedesign);
  const isRedesignEnabled = () =>
    !redesignFlag().loading && redesignFlag().enabled;
  const view = createDriveViewState(props.route, () => list.reset());
  const isDedicatedRedesignTab = (
    location: ReturnType<typeof view.value>['location']
  ) =>
    location.kind === 'tab' &&
    (location.tab === 'starred' || location.tab === 'trash');
  const viewState = () => {
    const current = view.value();
    if (!isRedesignEnabled() && isDedicatedRedesignTab(current.location)) {
      return {
        ...current,
        location: { kind: 'tab' as const, tab: 'owned' as const },
      };
    }
    return current;
  };
  const searchText = () => viewState().search;
  const selection = () => ({ ...viewState(), search: searchText() });
  const rawSidebar = createDriveSidebarSource({
    databasesEnabled: () => true,
    formsEnabled: () => true,
  });
  const optimisticFolders = createOptimisticFoldersController(
    rawSidebar.folders
  );
  const sidebar = {
    ...rawSidebar,
    folders: optimisticFolders.folders,
  };
  const agents = useDriveAgents(userId);
  // Rows show their folder's path from the folders the sidebar already holds.
  const knownFolders = createMemo(
    () =>
      new Map<string, KnownFolder>(
        sidebar.folders().map((folder) => [
          folder.id,
          {
            id: folder.id,
            name: folder.name,
            parentId: folder.parentId,
            ownerId: folder.userId,
          },
        ])
      )
  );
  const source = withSplitPanelOwner(listOwnedSlotName('data-source'), () =>
    createDriveDataSource({
      selection,
      databasesEnabled: () => true,
      formsEnabled: () => true,
      userId,
      myAgentIds: agents.myAgentIds,
      teamAgentIds: agents.teamAgentIds,
      tagSets,
      tagSetsReady,
      notificationSource,
    })
  );
  usePending('drive.items', source.isLoading);
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
    state: viewState,
    setState: view.setValue,
    folders: sidebar.folders,
    list,
    showList: () => {
      navigation.clear();
    },
  });

  createOpenTracker('project', () => {
    const location = view.value().location;
    if (location.kind !== 'folder' || !location.id) return undefined;
    return knownFolders().has(location.id) ? location.id : undefined;
  });

  createEffect(
    on(
      () => {
        const location = view.value().location;
        if (
          sidebar.foldersLoading() ||
          sidebar.foldersError() ||
          location.kind !== 'folder' ||
          !location.id
        )
          return;
        return sidebar.folders().some((folder) => folder.id === location.id)
          ? undefined
          : location.id;
      },
      (unavailableFolderId) => {
        if (!unavailableFolderId) return;
        view.update(
          {
            ...view.value(),
            location: { kind: 'folder', id: null },
            scope: 'default',
            search: '',
            facets: {},
          },
          { replace: true }
        );
        toast.alert('Folder unavailable', {
          subtext: 'It may have moved, been deleted, or no longer be shared.',
        });
      }
    )
  );

  onCleanup(
    panel.handle.registerEntryStateCaptor('drive.returnLabel', () =>
      driveLocationLabel(view.value().location, sidebar.folders())
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
        markRowNotificationsSeenOnOpen(entity, notificationSource);
        fireAndForget(
          openEntityInSplitFromUnifiedList(entity, {
            splitHandle: panel.handle,
            ...options,
          }),
          'open-entity-in-split'
        );
      },
    });
  });
  onMount(() => panel.handle.setDisplayName('Drive'));

  // If the redesign flag is explicitly off (e.g. rollback or shared bookmark),
  // rewrite dedicated /drive/starred or /drive/trash URLs to My Files while
  // preserving any open file detail, trail state, and search parameters.
  createEffect(() => {
    const flag = redesignFlag();
    if (flag.loading || flag.enabled) return;
    const current = view.value();
    if (!isDedicatedRedesignTab(current.location)) return;
    props.route.replaceLocationPreservingDetail({ kind: 'tab', tab: 'owned' });
  });

  function DriveRedesignBoundary() {
    const preferences = createDriveViewPreferences();
    const inlineEdit = createDriveInlineEdit();
    const inspector = createDriveInspector({
      open: preferences.inspectorOpen,
      setOpen: preferences.setInspectorOpen,
    });
    const trash = createDriveTrashSource(() => {
      const loc = selection().location;
      return loc.kind === 'tab' && loc.tab === 'trash';
    });
    const { host, undo } = createDriveRedesignHost({
      userId,
      projectId: () => state.projectId(),
      folders: sidebar.folders,
      items: source.items,
      baseActions: actions,
      optimisticFolders,
    });
    const [inspectedEntity, setInspectedEntity] = createSignal<
      EntityData | undefined
    >();
    const [selectedEntities, setSelectedEntities] = createSignal<EntityData[]>(
      []
    );
    let clearSelectionHandler: (() => void) | undefined;
    let focusSearchHandler: (() => void) | undefined;

    const createFolderContents = (folderId: Accessor<string | null>) =>
      createDriveFolderContentsSource({
        folderId,
        sort: () => selection().sort,
        userId,
        tagSets,
        tagSetsReady,
        notificationSource,
      });

    return (
      <DriveRedesignProvider
        value={{
          preferences,
          inlineEdit,
          inspector,
          undo,
          trash,
          host,
          agents,
          createFolderContents,
          inspectedEntity,
          setInspectedEntity,
          selectedEntities,
          setSelectedEntities,
          clearActiveSelection: () => clearSelectionHandler?.(),
          registerClearSelection: (handler) => {
            clearSelectionHandler = handler;
            return () => {
              if (clearSelectionHandler === handler) {
                clearSelectionHandler = undefined;
              }
            };
          },
          focusSearch: () => focusSearchHandler?.(),
          registerFocusSearch: (handler) => {
            focusSearchHandler = handler;
            return () => {
              if (focusSearchHandler === handler) {
                focusSearchHandler = undefined;
              }
            };
          },
        }}
      >
        <DriveRedesignEntry tour={<ViewTour tour={documentsTour} />} />
      </DriveRedesignProvider>
    );
  }

  return (
    <DriveProvider
      value={{
        state: { ...state, value: selection },
        source,
        list,
        sidebar,
        actions,
        tutorials,
      }}
    >
      <KnownFoldersProvider value={knownFolders}>
        <Show
          when={
            !redesignFlag().loading ||
            !isDedicatedRedesignTab(view.value().location)
          }
          fallback={<DriveLoading />}
        >
          <Show
            when={isRedesignEnabled()}
            fallback={
              <DriveWorkspace tour={<ViewTour tour={documentsTour} />} />
            }
          >
            <DriveRedesignBoundary />
          </Show>
        </Show>
      </KnownFoldersProvider>
    </DriveProvider>
  );
}

/** Public details use the same viewer without constructing private Drive sources. */
export function SignedOutDriveView() {
  const route = createDriveRouteState(() => undefined);
  return (
    <DriveDetailNavigationProvider location={route.location}>
      <SignedOutDriveWorkspace />
    </DriveDetailNavigationProvider>
  );
}

export function DriveView(props: DriveViewProps) {
  const route = createDriveRouteState(() => props.initialFacets);
  return (
    <DriveDetailNavigationProvider location={route.location}>
      <ListEntityMetadataQueryProvider>
        <Suspense fallback={<DriveLoading />}>
          <DriveComposition route={route} />
        </Suspense>
      </ListEntityMetadataQueryProvider>
    </DriveDetailNavigationProvider>
  );
}
