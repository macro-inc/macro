import {
  CollectionPanes,
  useViewTabHotkeys,
  ViewShell,
} from '@app/components/view-shell';
import { MobileListLayout } from '@app/components/view-shell/MobileListLayout';
import { FolderDropZone } from '@app/features/next-soup/actions';
import { SplitRouter } from '@app/lib/split-router';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import { createMemo, type JSX, Show, Suspense } from 'solid-js';
import { DriveFileDropzone } from '../components/drive-file-dropzone';
import { useDriveView } from '../context/drive-context';
import { driveLocationBreadcrumbs } from '../core/breadcrumbs';
import { DRIVE_TABS } from '../core/types';
import { useDriveDetailNavigation } from '../drive-detail-navigation';
import { DriveBreadcrumbs } from './drive-breadcrumbs';
import {
  DriveFolderHierarchy,
  DriveFolderPath,
  useDriveFolderHierarchyVisible,
} from './drive-folder-hierarchy';
import { DriveHeader } from './drive-header';
import { DriveList } from './drive-list';
import { DriveMobileControls } from './drive-mobile-controls';
import { DriveSidebar } from './drive-sidebar';

export function DriveLoading() {
  return (
    <div class="grid size-full place-items-center text-ink-muted">
      <SpinnerIcon
        aria-hidden={false}
        aria-label="Loading files"
        class="size-5 animate-spin"
      />
    </div>
  );
}

function DriveBrowser() {
  const folderHierarchy = useDriveFolderHierarchyVisible();

  return (
    <Show when={folderHierarchy()} fallback={<DriveList />}>
      <DriveFolderHierarchy />
    </Show>
  );
}

export function DriveWorkspace(props: { tour?: JSX.Element }) {
  const { state, sidebar, actions } = useDriveView();

  const navigation = useDriveDetailNavigation();

  const breadcrumbs = createMemo(() =>
    navigation.showsLocation()
      ? driveLocationBreadcrumbs(state.value().location, sidebar.folders())
      : []
  );

  const panel = useSplitPanelOrThrow();

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,

    ids: () => DRIVE_TABS.map((tab) => tab.id),

    activeId: () => {
      const location = state.value().location;

      return location.kind === 'tab' ? location.tab : 'owned';
    },

    setActiveId: state.selectTab,
  });

  return (
    <DriveBreadcrumbs entries={breadcrumbs()}>
      <SplitPanel.Root>
        <SplitPanel.Body>
          <ViewShell.Root
            contentLayout="collection"
            asidePreferenceKey="documents"
            resizable
            aside={{ preserveDuringResize: false }}
            main={{ preferredWidth: 640 }}
          >
            <ViewShell.Aside>
              <DriveSidebar />
            </ViewShell.Aside>
            <CollectionPanes
              hasDetail={!!navigation.active() || !!navigation.activeCallId()}
              list={
                <MobileListLayout
                  header={
                    <div class="flex min-w-0 flex-col gap-1">
                      <DriveMobileControls />
                      <DriveFolderPath />
                    </div>
                  }
                >
                  <DriveHeader />
                  {props.tour}
                  <ViewShell.Content>
                    <Suspense fallback={<DriveLoading />}>
                      <FolderDropZone folderId={state.projectId()}>
                        <DriveFileDropzone onDrop={actions.dropFiles}>
                          <DriveBrowser />
                        </DriveFileDropzone>
                      </FolderDropZone>
                    </Suspense>
                  </ViewShell.Content>
                </MobileListLayout>
              }
            >
              <Suspense fallback={<DriveLoading />}>
                <SplitRouter.Outlet />
              </Suspense>
            </CollectionPanes>
          </ViewShell.Root>
        </SplitPanel.Body>
      </SplitPanel.Root>
    </DriveBreadcrumbs>
  );
}
