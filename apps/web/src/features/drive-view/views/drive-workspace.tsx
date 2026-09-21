import { useViewTabHotkeys, ViewShell } from '@app/components/view-shell';
import { SplitRouter } from '@app/split-router';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import SpinnerIcon from '@phosphor/spinner.svg';
import { createMemo, Show, Suspense } from 'solid-js';
import { DriveFileDropzone } from '../components/drive-file-dropzone';
import { useDriveView } from '../context/drive-context';
import { driveLocationBreadcrumbs } from '../core/breadcrumbs';
import { DRIVE_TABS } from '../core/types';
import { useDriveDetailNavigation } from '../drive-detail-navigation';
import { DriveBreadcrumbs } from './drive-breadcrumbs';
import { DriveHeader } from './drive-header';
import { DriveList } from './drive-list';
import { DriveSidebar } from './drive-sidebar';

export function DriveLoading() {
  return (
    <div class="grid size-full place-items-center text-ink-muted">
      <SpinnerIcon aria-label="Loading files" class="size-5 animate-spin" />
    </div>
  );
}

export function DriveWorkspace() {
  const { state, sidebar, actions } = useDriveView();

  const breadcrumbs = createMemo(() =>
    driveLocationBreadcrumbs(state.value().location, sidebar.folders())
  );

  const navigation = useDriveDetailNavigation();

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
            asidePreferenceKey="documents"
            resizable
            aside={{ preserveDuringResize: false }}
            main={{ preferredWidth: 640 }}
          >
            <ViewShell.Aside>
              <DriveSidebar />
            </ViewShell.Aside>
            <ViewShell.Main>
              <Show
                when={navigation.active()}
                fallback={
                  <>
                    <DriveHeader />
                    <ViewShell.Content>
                      <Suspense fallback={<DriveLoading />}>
                        <DriveFileDropzone onDrop={actions.dropFiles}>
                          <DriveList />
                        </DriveFileDropzone>
                      </Suspense>
                    </ViewShell.Content>
                  </>
                }
              >
                <SplitRouter.Outlet />
              </Show>
            </ViewShell.Main>
          </ViewShell.Root>
        </SplitPanel.Body>
      </SplitPanel.Root>
    </DriveBreadcrumbs>
  );
}
