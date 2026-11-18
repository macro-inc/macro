import { ViewSidebar } from '@app/components/view-shell';
import { Show } from 'solid-js';
import { DriveFilterDrawer } from './drive-filter-drawer';
import { useDriveFolderHierarchyVisible } from './drive-folder-hierarchy';

/** Touch list controls; Drive's tabs and folders live in the sidebar sheet. */
export function DriveMobileControls() {
  const folderHierarchy = useDriveFolderHierarchyVisible();

  return (
    <div class="flex h-10 min-w-0 flex-1 items-center">
      <div class="pointer-events-auto flex items-center gap-2">
        <ViewSidebar.Toggle action="expand" presentation="pill" />
        <Show when={!folderHierarchy()}>
          <DriveFilterDrawer />
        </Show>
      </div>
    </div>
  );
}
