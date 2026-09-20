import {
  CollapsibleSection,
  SearchBar,
  ViewSidebar,
} from '@app/components/view-shell';
import { FavoriteContextMenu } from '@app/features/favorites/FavoriteContextMenu';
import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import { useFavoriteDisplayName } from '@app/util/favorites';
import FolderIcon from '@phosphor/folder.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { SidebarTagsSection } from '@property/tags/SidebarTagsSection';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { Button } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { DriveNavigation } from '../components/drive-navigation';
import { FolderTree } from '../components/folder-tree';
import { useDriveView } from '../context/drive-context';
import { buildFolderTree, filterFolderTree } from '../core/folder-tree';
import { DriveCreateMenu } from '../drive-create-menu';
import { DriveLocationMenu } from '../drive-location-menu';

function DriveFavorite(props: { favorite: Favorite; onNavigate?: () => void }) {
  const { actions } = useDriveView();

  const name = useFavoriteDisplayName(props.favorite);

  return (
    <FavoriteContextMenu favorite={props.favorite} triggerClass="block">
      <ViewSidebar.Item
        title={name()}
        onClick={(event) => {
          actions.openFavorite(props.favorite, name(), event);
          props.onNavigate?.();
        }}
      >
        <ViewSidebar.Icon>
          <FavoriteIcon favorite={props.favorite} class="size-4" />
        </ViewSidebar.Icon>
        <span class="truncate">{name()}</span>
      </ViewSidebar.Item>
    </FavoriteContextMenu>
  );
}

/** Also used by the narrow-layout navigation menu. */
export function DriveSidebarContent(props: { onNavigate?: () => void }) {
  const { state, sidebar } = useDriveView();

  const [folderSearch, setFolderSearch] = createSignal('');

  const [searchingFolders, setSearchingFolders] = createSignal(false);

  const tree = createMemo(() => buildFolderTree(sidebar.folders()));

  const filteredTree = createMemo(() =>
    filterFolderTree(tree(), folderSearch())
  );

  const selectedFolder = () => {
    const location = state.value().location;

    return location.kind === 'folder' ? location.id : undefined;
  };

  const selectFolder = (id: string | null) => {
    state.selectFolder(id);
    props.onNavigate?.();
  };

  return (
    <>
      <DriveNavigation
        locationMenu={DriveLocationMenu}
        location={state.value().location}
        onNavigate={(tab) => {
          state.selectTab(tab);
          props.onNavigate?.();
        }}
      />
      <Show when={sidebar.favorites().length > 0}>
        <CollapsibleSection.Root
          open={state.value().favoritesOpen}
          onOpenChange={state.setFavoritesOpen}
        >
          <CollapsibleSection.Trigger>
            <span class="min-w-0 truncate">Favorites</span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
          <CollapsibleSection.Content>
            <ViewSidebar.Nav aria-label="Favorite files and folders">
              <For each={sidebar.favorites()}>
                {(favorite) => (
                  <DriveFavorite
                    favorite={favorite}
                    onNavigate={props.onNavigate}
                  />
                )}
              </For>
            </ViewSidebar.Nav>
          </CollapsibleSection.Content>
        </CollapsibleSection.Root>
      </Show>
      <CollapsibleSection.Root
        open={state.value().rootOpen}
        onOpenChange={state.setRootOpen}
      >
        <CollapsibleSection.Header>
          <CollapsibleSection.Trigger class="flex-1">
            <span class="min-w-0 truncate">Folders</span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
          <CollapsibleSection.Action
            label="Search folders"
            onClick={() => {
              const open = !searchingFolders();

              setSearchingFolders(open);
              setFolderSearch('');

              if (open) state.setRootOpen(true);
            }}
          >
            <SearchIcon class="size-3.5" />
          </CollapsibleSection.Action>
        </CollapsibleSection.Header>
        <CollapsibleSection.Content>
          <Show when={searchingFolders()}>
            <SearchBar
              label="Search folders"
              placeholder="Search folders"
              value={folderSearch()}
              onValueChange={setFolderSearch}
              class="mb-2"
            />
          </Show>
          <ViewSidebar.Nav aria-label="Folders">
            <DriveLocationMenu location={{ kind: 'folder', id: null }}>
              <ViewSidebar.Item
                active={selectedFolder() === null}
                onClick={() => selectFolder(null)}
              >
                <ViewSidebar.Icon>
                  <FolderIcon class="size-4" />
                </ViewSidebar.Icon>
                <span>Drive</span>
              </ViewSidebar.Item>
            </DriveLocationMenu>
            <ViewSidebar.Branch>
              <Show
                when={!sidebar.foldersLoading()}
                fallback={
                  <p
                    role="status"
                    class="px-3 py-2 text-sm text-ink-extra-muted"
                  >
                    Loading folders…
                  </p>
                }
              >
                <Show
                  when={!sidebar.foldersError()}
                  fallback={
                    <div class="p-3 text-sm text-ink-muted">
                      Folders couldn’t be loaded.
                      <Button
                        variant="ghost"
                        onClick={() => void sidebar.retryFolders()}
                      >
                        Try again
                      </Button>
                    </div>
                  }
                >
                  <FolderTree
                    locationMenu={DriveLocationMenu}
                    nodes={filteredTree()}
                    selectedId={selectedFolder()}
                    expandedIds={state.value().expandedFolderIds}
                    searching={!!folderSearch().trim()}
                    onToggle={state.toggleFolder}
                    onSelect={selectFolder}
                  />
                  <Show when={filteredTree().length === 0}>
                    <p class="px-3 py-2 text-sm text-ink-extra-muted">
                      {folderSearch()
                        ? 'No matching folders'
                        : 'No folders yet'}
                    </p>
                  </Show>
                </Show>
              </Show>
            </ViewSidebar.Branch>
          </ViewSidebar.Nav>
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>
      <SidebarTagsSection
        activeIds={state.value().facets.tags ?? []}
        onActiveIdsChange={state.setTags}
        open={state.value().tagsOpen}
        onOpenChange={state.setTagsOpen}
        onNavigate={props.onNavigate}
      />
    </>
  );
}

export function DriveSidebar() {
  return (
    <ViewSidebar.Root aria-label="Drive navigation">
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <ViewSidebar.CloseButton />
          <ViewSidebar.Title>Drive</ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>
      <ViewSidebar.Primary>
        <DriveCreateMenu />
      </ViewSidebar.Primary>
      <ViewSidebar.Content>
        <DriveSidebarContent />
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
