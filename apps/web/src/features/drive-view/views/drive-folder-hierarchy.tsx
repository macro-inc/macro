import {
  SearchBar,
  useViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import { createFolderDropTargets } from '@app/features/next-soup/actions';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createScrollTopFade } from '@core/util/createScrollTopFade';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button } from '@ui';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { FolderTree } from '../components/folder-tree';
import { useDriveView } from '../context/drive-context';
import {
  buildFolderTree,
  filterFolderTree,
  folderAncestors,
} from '../core/folder-tree';
import { DriveLocationMenu } from '../drive-location-menu';

/**
 * The sidebar tree is unreachable on touch (its toggle is hidden and the
 * narrow aside starts closed). The Folders overview then shows that tree.
 */
export function useDriveFolderHierarchyVisible() {
  const { state } = useDriveView();
  const shell = useViewShell();

  return () => {
    const location = state.value().location;
    const sidebarHidden =
      shell.width() === undefined ||
      shell.aside.isCollapsed() ||
      shell.aside.isOverlay();

    return (
      isTouchDevice() &&
      sidebarHidden &&
      location.kind === 'folder' &&
      location.id === null
    );
  };
}

/** Ancestors of the open folder, under the touch pills. */
export function DriveFolderPath() {
  const { state, sidebar } = useDriveView();

  const crumbs = createMemo(() => {
    const location = state.value().location;
    if (location.kind !== 'folder' || !location.id) return [];

    return folderAncestors(sidebar.folders(), location.id);
  });

  let nav: HTMLElement | undefined;

  // Keep the open folder in view when the path is longer than the screen.
  createEffect(() => {
    crumbs();
    nav?.scrollTo({ left: nav.scrollWidth });
  });

  return (
    <Show when={crumbs().length > 0}>
      <nav
        ref={nav}
        aria-label="Folder path"
        class="flex min-w-0 items-center gap-0.5 overflow-x-auto text-sm"
      >
        <button
          type="button"
          class="flex h-11 shrink-0 items-center rounded-lg px-2 text-ink-muted outline-none not-touch:hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => state.selectFolder(null)}
        >
          Folders
        </button>
        <For each={crumbs()}>
          {(folder, index) => {
            const current = () => index() === crumbs().length - 1;

            return (
              <span class="flex min-w-0 shrink-0 items-center">
                <span aria-hidden="true" class="shrink-0 text-ink-extra-muted">
                  /
                </span>
                <Show
                  when={!current()}
                  fallback={
                    <span
                      aria-current="page"
                      class="flex h-11 min-w-0 items-center px-2 font-semibold tracking-[-0.03em] text-ink"
                    >
                      <span class="truncate">{folder.name}</span>
                    </span>
                  }
                >
                  <button
                    type="button"
                    class="flex h-11 min-w-0 items-center rounded-lg px-2 text-ink-muted outline-none not-touch:hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                    onClick={() => state.selectFolder(folder.id)}
                  >
                    <span class="max-w-40 truncate">{folder.name}</span>
                  </button>
                </Show>
              </span>
            );
          }}
        </For>
      </nav>
    </Show>
  );
}

export function DriveFolderHierarchy() {
  const { state, sidebar } = useDriveView();

  const [folderSearch, setFolderSearch] = createSignal('');

  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  createScrollTopFade(viewport);

  const tree = createMemo(() => buildFolderTree(sidebar.folders()));

  const filteredTree = createMemo(() =>
    filterFolderTree(tree(), folderSearch())
  );

  const createDropTarget = createFolderDropTargets();

  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col">
      <div class="shrink-0 px-(--mobile-chrome-gutter) pb-2">
        <SearchBar
          label="Search folders"
          placeholder="Search folders"
          value={folderSearch()}
          onValueChange={setFolderSearch}
        />
      </div>
      <div
        ref={setViewport}
        class="min-h-0 flex-1 overflow-auto overscroll-none px-2 pb-[calc(var(--mobile-content-inset-bottom,0px)+0.75rem)]"
      >
        <Show
          when={!sidebar.foldersLoading()}
          fallback={
            <p role="status" class="px-3 py-2 text-sm text-ink-extra-muted">
              Loading folders…
            </p>
          }
        >
          <Show
            when={!sidebar.foldersError()}
            fallback={
              <div class="flex flex-col items-start gap-2 p-3 text-sm text-ink-muted">
                Folders couldn’t be loaded.
                <Button
                  variant="secondary"
                  onClick={() =>
                    fireAndForget(sidebar.retryFolders(), 'drive-view')
                  }
                >
                  Try again
                </Button>
              </div>
            }
          >
            <ViewSidebar.Nav aria-label="Folders">
              <FolderTree
                locationMenu={DriveLocationMenu}
                nodes={filteredTree()}
                selectedId={null}
                expandedIds={state.value().expandedFolderIds}
                searching={!!folderSearch().trim()}
                onToggle={state.toggleFolder}
                onSelect={state.selectFolder}
                createDropTarget={createDropTarget}
              />
            </ViewSidebar.Nav>
            <Show when={filteredTree().length === 0}>
              <p class="px-3 py-2 text-sm text-ink-extra-muted">
                {folderSearch() ? 'No matching folders' : 'No folders yet'}
              </p>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}
