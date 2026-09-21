import {
  EntityDetailNavigationStack,
  useEntityDetailNavigationStack,
} from '@app/components/entity-detail/EntityDetailNavigationStack';
import { listOwnedSlotName } from '@app/components/list';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import {
  type FacetSelection,
  useSoupListNavigationHotkeys,
} from '@app/features/soup';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useEntryState } from '@components/app/split-layout/entry-state';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { useUserId } from '@core/context/user';
import { ListEntityMetadataQueryProvider } from '@entity';
import { useTagSets, useTagSetsReady } from '@property/tags/tag-sets-context';
import { onCleanup, onMount, Suspense } from 'solid-js';
import { DriveProvider } from './context/drive-context';
import { driveLocationLabel } from './core/location-label';
import type { DriveState } from './core/types';
import { createDriveHostActions } from './drive-host-actions';
import {
  createDriveList,
  parseDriveListSnapshot,
} from './primitives/drive-list';
import { createDriveState } from './primitives/drive-state';
import { createDriveDataSource } from './queries/drive-data-source';
import { createDriveSidebarSource } from './queries/drive-sidebar-source';
import { DriveLoading, DriveWorkspace } from './views/drive-workspace';

export type DriveViewProps = { initialFacets?: FacetSelection };

/** The only place that constructs production sources and app capabilities. */
function DriveComposition(props: DriveViewProps) {
  const panel = useSplitPanelOrThrow();

  const navigation = useEntityDetailNavigationStack();

  const userId = useUserId();

  const notificationSource = useGlobalNotificationSource();

  const tagSets = useTagSets();

  const tagSetsReady = useTagSetsReady();

  const [value, setValue] = useEntryState<DriveState>('drive.view.v2', {
    default: {
      location: { kind: 'tab', tab: 'owned' },
      scope: 'default',
      sort: 'updated_at',
      search: '',
      facets: props.initialFacets ?? {},
      expandedFolderIds: [],
      favoritesOpen: true,
      rootOpen: true,
      tagsOpen: true,
    },
  });

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
  return (
    <EntityDetailNavigationStack.Root>
      <ListEntityMetadataQueryProvider>
        <Suspense fallback={<DriveLoading />}>
          <DriveComposition {...props} />
        </Suspense>
      </ListEntityMetadataQueryProvider>
    </EntityDetailNavigationStack.Root>
  );
}
