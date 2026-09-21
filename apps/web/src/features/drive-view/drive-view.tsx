import { listOwnedSlotName } from '@app/components/list';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import {
  type FacetSelection,
  useSoupListNavigationHotkeys,
} from '@app/features/soup';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { ListEntityMetadataQueryProvider } from '@entity';
import { useTagSets, useTagSetsReady } from '@property/tags/tag-sets-context';
import { createEffect, on, onCleanup, onMount, Suspense } from 'solid-js';
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
import { DriveLoading, DriveWorkspace } from './views/drive-workspace';

export type DriveViewProps = { initialFacets?: FacetSelection };

/** Constructs production sources and injects app capabilities into the workspace. */
function DriveComposition(props: { route: DriveRouteState }) {
  const panel = useSplitPanelOrThrow();
  const navigation = useDriveDetailNavigation();
  const userId = useUserId();
  const notificationSource = useGlobalNotificationSource();
  const tagSets = useTagSets();
  const tagSetsReady = useTagSetsReady();
  const view = createDriveViewState(props.route, () => list.reset());
  const sidebar = createDriveSidebarSource();
  const source = withSplitPanelOwner(listOwnedSlotName('data-source'), () =>
    createDriveDataSource({
      selection: view.value,
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
    state: view.value,
    setState: view.setValue,
    folders: sidebar.folders,
    list,
    showList: () => {
      navigation.clear();
    },
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
