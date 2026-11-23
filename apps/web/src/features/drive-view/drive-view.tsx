import { listOwnedSlotName } from '@app/components/list';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import {
  type FacetSelection,
  useSoupListNavigationHotkeys,
} from '@app/features/soup';
import { ViewTour } from '@app/features/tours/ViewTour';
import type { TutorialId } from '@app/features/video-tutorials';
import { usePending } from '@app/observability/flow';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { createOpenTracker } from '@core/internal/open-tracker';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type KnownFolder,
  KnownFoldersProvider,
  ListEntityMetadataQueryProvider,
} from '@entity';
import { markRowNotificationsSeenOnOpen } from '@notifications/mark-row-seen';
import { useTagSets, useTagSetsReady } from '@property/tags/tag-sets-context';
import {
  createEffect,
  createMemo,
  on,
  onCleanup,
  onMount,
  Suspense,
} from 'solid-js';
import { DriveProvider } from './context/drive-context';
import { driveLocationLabel } from './core/location-label';
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
  createDriveRouteState,
  createDriveViewState,
  type DriveRouteState,
} from './primitives/drive-route-state';
import { createDriveState } from './primitives/drive-state';
import { createDriveDataSource } from './queries/drive-data-source';
import { createDriveSidebarSource } from './queries/drive-sidebar-source';
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
  const view = createDriveViewState(props.route, () => list.reset());
  const viewState = view.value;
  const searchText = () => view.value().search;
  const selection = () => ({ ...viewState(), search: searchText() });
  const sidebar = createDriveSidebarSource({
    databasesEnabled: () => true,
    formsEnabled: () => true,
  });
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
        <DriveWorkspace tour={<ViewTour tour={documentsTour} />} />
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
