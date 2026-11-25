import { CollectionPanes, ViewShell } from '@app/components/view-shell';
import { FolderDropZone } from '@app/features/next-soup/actions';
import { SplitRouter } from '@app/lib/split-router';
import { SplitPanel } from '@components/app/split-panel';
import { createMemo, type JSX, Match, Show, Suspense, Switch } from 'solid-js';
import { DriveFileDropzone } from '../../components/drive-file-dropzone';
import { useDriveView } from '../../context/drive-context';
import { useDriveRedesign } from '../../context/drive-redesign-context';
import { driveLocationBreadcrumbs } from '../../core/breadcrumbs';
import { useDriveDetailNavigation } from '../../drive-detail-navigation';
import { DriveBreadcrumbs } from '../drive-breadcrumbs';
import { DriveLoading } from '../drive-workspace';
import { DriveRedesignColumns } from './drive-redesign-columns';
import { DriveRedesignGrid } from './drive-redesign-grid';
import { DriveRedesignHeader } from './drive-redesign-header';
import { DriveRedesignInspector } from './drive-redesign-inspector';
import { DriveRedesignList } from './drive-redesign-list';
import { DriveRedesignSidebar } from './drive-redesign-sidebar';
import { DriveRedesignStarred } from './drive-redesign-starred';
import { DriveRedesignTrash } from './drive-redesign-trash';

/**
 * Desktop Drive Redesign workspace: pairs the redesigned navigation sidebar,
 * single-row drop-target breadcrumb header, List/Grid/Columns/Starred/Trash
 * views, and the Spacebar Quick Look + Details Inspector pane.
 */
export function DriveRedesignWorkspace(props: { tour?: JSX.Element }) {
  const { state, sidebar, actions } = useDriveView();
  const { preferences, inlineEdit, host } = useDriveRedesign();
  const navigation = useDriveDetailNavigation();

  const breadcrumbs = createMemo(() =>
    navigation.showsLocation()
      ? driveLocationBreadcrumbs(state.value().location, sidebar.folders())
      : []
  );

  const location = () => state.value().location;

  const isTrash = () => {
    const loc = location();
    return loc.kind === 'tab' && loc.tab === 'trash';
  };

  const isStarred = () => {
    const loc = location();
    return loc.kind === 'tab' && loc.tab === 'starred';
  };

  const startInlineFolder = () => {
    const mode = preferences.viewMode();
    const surface =
      mode === 'grid' ? 'grid' : mode === 'columns' ? 'columns' : 'list';
    inlineEdit.startCreateFolder({
      parentId: state.projectId() ?? null,
      surface,
    });
  };

  const isColumnsSupported = () => {
    const current = state.value();
    const loc = current.location;
    if (current.search.trim().length > 0) return false;
    if (
      current.scope !== 'default' ||
      Object.values(current.facets).some((values) => (values?.length ?? 0) > 0)
    ) {
      return false;
    }
    if (loc.kind === 'folder') return true;
    return loc.tab === 'owned' && preferences.rootMode() === 'browse';
  };

  return (
    <DriveBreadcrumbs entries={breadcrumbs()}>
      <SplitPanel.Root>
        <SplitPanel.Body>
          <ViewShell.Root
            contentLayout="collection"
            asidePreferenceKey="documents"
            resizable
            aside={{ preserveDuringResize: false }}
            main={{ preferredWidth: 680 }}
          >
            <ViewShell.Aside>
              <DriveRedesignSidebar onStartInlineFolder={startInlineFolder} />
            </ViewShell.Aside>

            <CollectionPanes
              hasDetail={Boolean(
                navigation.active() || navigation.activeCallId()
              )}
              list={
                <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
                  <DriveRedesignHeader
                    onStartInlineFolder={startInlineFolder}
                  />
                  {props.tour}
                  <ViewShell.Content>
                    <div class="flex size-full min-h-0 min-w-0 flex-row overflow-hidden">
                      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                        <Suspense fallback={<DriveLoading />}>
                          <FolderDropZone
                            folderId={state.projectId()}
                            onMove={host.moveEntitiesWithUndo}
                          >
                            <DriveFileDropzone onDrop={actions.dropFiles}>
                              <Switch>
                                <Match when={isTrash()}>
                                  <DriveRedesignTrash />
                                </Match>
                                <Match when={isStarred()}>
                                  <DriveRedesignStarred />
                                </Match>
                                <Match
                                  when={
                                    preferences.viewMode() === 'columns' &&
                                    isColumnsSupported()
                                  }
                                >
                                  <DriveRedesignColumns />
                                </Match>
                                <Match when={preferences.viewMode() === 'grid'}>
                                  <DriveRedesignGrid
                                    onStartInlineFolder={startInlineFolder}
                                  />
                                </Match>
                                <Match when={true}>
                                  <DriveRedesignList
                                    onStartInlineFolder={startInlineFolder}
                                  />
                                </Match>
                              </Switch>
                            </DriveFileDropzone>
                          </FolderDropZone>
                        </Suspense>
                      </div>
                      <Show when={!isTrash() && !isStarred()}>
                        <DriveRedesignInspector />
                      </Show>
                    </div>
                  </ViewShell.Content>
                </div>
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
