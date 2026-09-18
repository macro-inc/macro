import {
  CollapsibleSection,
  ListSortDropdown,
  SearchBar,
  ViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretDownIcon from '@phosphor/caret-down.svg';
import FolderIcon from '@phosphor/folder.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { Button, Dropdown } from '@ui';
import { createMemo, createSignal, type JSX, Show } from 'solid-js';
import { DriveBreadcrumbsOutlet } from '../components/DriveBreadcrumbs';
import {
  type DriveLocationMenu,
  DriveNavigation,
} from '../components/drive-navigation';
import { FolderTree } from '../components/folder-tree';
import { buildFolderTree, filterFolderTree } from '../core/folder-tree';
import { driveLocationLabel } from '../core/location-label';
import type {
  DriveFolder,
  DriveSort,
  DriveState,
  DriveTab,
} from '../core/types';

export function DriveLayout(props: {
  state: DriveState;
  folders: DriveFolder[];
  foldersLoading: boolean;
  foldersError: boolean;
  onRetryFolders: () => void;
  search: string;
  onSearch: (value: string) => void;
  searchRef: (element: HTMLInputElement) => void;
  onTab: (tab: DriveTab) => void;
  onFolder: (id: string | null) => void;
  filterMenu: () => JSX.Element;
  onSort: (sort: DriveSort) => void;
  onToggleFolder: (id: string) => void;
  onFavoritesOpen: (open: boolean) => void;
  onRootOpen: (open: boolean) => void;
  createMenu: () => JSX.Element;
  favorites: () => JSX.Element;
  locationMenu: DriveLocationMenu;
  detail?: JSX.Element;
  children: JSX.Element;
}) {
  const [folderSearch, setFolderSearch] = createSignal('');
  const [searchingFolders, setSearchingFolders] = createSignal(false);
  const [navigationOpen, setNavigationOpen] = createSignal(false);
  const tree = createMemo(() => buildFolderTree(props.folders));
  const filteredTree = createMemo(() =>
    filterFolderTree(tree(), folderSearch())
  );
  const selectedFolder = () =>
    props.state.location.kind === 'folder'
      ? props.state.location.id
      : undefined;
  const title = () => driveLocationLabel(props.state.location, props.folders);

  const SidebarContent = () => (
    <>
      <DriveNavigation
        locationMenu={props.locationMenu}
        location={props.state.location}
        onNavigate={(tab) => {
          props.onTab(tab);
          setNavigationOpen(false);
        }}
      />
      <CollapsibleSection.Root
        open={props.state.favoritesOpen}
        onOpenChange={props.onFavoritesOpen}
      >
        <CollapsibleSection.Trigger>
          <span class="min-w-0 truncate">Favorites</span>
          <CollapsibleSection.Indicator />
        </CollapsibleSection.Trigger>
        <CollapsibleSection.Content>
          <props.favorites />
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>
      <CollapsibleSection.Root
        open={props.state.rootOpen}
        onOpenChange={props.onRootOpen}
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
              if (open) props.onRootOpen(true);
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
            <props.locationMenu location={{ kind: 'folder', id: null }}>
              <ViewSidebar.Item
                active={selectedFolder() === null}
                onClick={() => {
                  props.onFolder(null);
                  setNavigationOpen(false);
                }}
              >
                <ViewSidebar.Icon>
                  <FolderIcon class="size-4" />
                </ViewSidebar.Icon>
                <span>Drive</span>
              </ViewSidebar.Item>
            </props.locationMenu>
            <ViewSidebar.Branch>
              <Show
                when={!props.foldersLoading}
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
                  when={!props.foldersError}
                  fallback={
                    <div class="p-3 text-sm text-ink-muted">
                      Folders couldn’t be loaded.
                      <Button variant="ghost" onClick={props.onRetryFolders}>
                        Try again
                      </Button>
                    </div>
                  }
                >
                  <FolderTree
                    locationMenu={props.locationMenu}
                    nodes={filteredTree()}
                    selectedId={selectedFolder()}
                    expandedIds={props.state.expandedFolderIds}
                    searching={!!folderSearch().trim()}
                    onToggle={props.onToggleFolder}
                    onSelect={(id) => {
                      props.onFolder(id);
                      setNavigationOpen(false);
                    }}
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
    </>
  );

  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <ViewShell.Root
          asidePreferenceKey="documents"
          resizable
          aside={{ preserveDuringResize: false }}
          main={{ preferredWidth: 640 }}
        >
          <ViewShell.Aside>
            <ViewSidebar.Root aria-label="Drive navigation">
              <ViewSidebar.Header>
                <div class="flex min-w-0 items-center gap-1">
                  <ViewSidebar.CloseButton />
                  <ViewSidebar.Title>Drive</ViewSidebar.Title>
                </div>
              </ViewSidebar.Header>
              <ViewSidebar.Primary>
                <props.createMenu />
              </ViewSidebar.Primary>
              <ViewSidebar.Content>
                <SidebarContent />
              </ViewSidebar.Content>
            </ViewSidebar.Root>
          </ViewShell.Aside>
          <ViewShell.Main>
            <Show
              when={props.detail}
              fallback={
                <>
                  <ViewShell.TopBar class="touch:flex">
                    <h1 class="hidden min-w-0 truncate text-sm font-semibold tracking-[-0.03em] text-ink @max-[720px]/view-shell:block">
                      Drive
                    </h1>
                    <DriveBreadcrumbsOutlet
                      aria-label="Drive location"
                      class="@max-[720px]/view-shell:hidden"
                    />
                  </ViewShell.TopBar>
                  <ViewShell.Header>
                    <div class="flex min-w-0 flex-col gap-3">
                      <div class="hidden min-w-0 items-center gap-2 @max-[720px]/view-shell:flex">
                        <Show
                          when={isTouchDevice()}
                          fallback={
                            <h1 class="min-w-0 truncate text-xl font-semibold tracking-[-0.03em] text-ink">
                              {title()}
                            </h1>
                          }
                        >
                          <Dropdown
                            open={navigationOpen()}
                            onOpenChange={setNavigationOpen}
                            placement="bottom-start"
                          >
                            <h1 class="min-w-0">
                              <Dropdown.Trigger
                                variant="ghost"
                                size="sm"
                                class="h-auto min-w-0 max-w-full gap-1 rounded-lg px-2 py-1 text-xl font-semibold tracking-[-0.03em] text-ink"
                                aria-label={`Select Drive view: ${title()}`}
                              >
                                <span class="truncate">{title()}</span>
                                <CaretDownIcon class="size-3.5 shrink-0 text-ink-muted" />
                              </Dropdown.Trigger>
                            </h1>
                            <Dropdown.Content class="max-h-[70vh] w-72 overflow-auto rounded-2xl">
                              <Dropdown.Group class="gap-5 p-3">
                                <SidebarContent />
                              </Dropdown.Group>
                            </Dropdown.Content>
                          </Dropdown>
                        </Show>
                        <div class="ml-auto shrink-0">
                          <props.createMenu />
                        </div>
                      </div>
                      <div class="flex min-w-0 items-center justify-between gap-3">
                        <Show when={!selectedFolder()}>
                          <SearchBar
                            ref={props.searchRef}
                            label="Search Drive"
                            placeholder="Search files"
                            value={props.search}
                            onValueChange={props.onSearch}
                            hotkey="cmd+f"
                            class="max-w-md flex-1"
                          />
                        </Show>
                        <div class="ml-auto flex shrink-0 items-center gap-2">
                          <Show
                            when={
                              !(
                                props.state.location.kind === 'tab' &&
                                props.state.location.tab === 'recent'
                              )
                            }
                          >
                            <ListSortDropdown
                              label="Sort files"
                              value={props.state.sort}
                              onChange={props.onSort}
                              options={[
                                { id: 'updated_at', label: 'Last modified' },
                                { id: 'created_at', label: 'Created' },
                                { id: 'viewed_at', label: 'Last viewed' },
                              ]}
                            />
                          </Show>
                          <props.filterMenu />
                        </div>
                      </div>
                    </div>
                  </ViewShell.Header>
                  <ViewShell.Content>{props.children}</ViewShell.Content>
                </>
              }
            >
              {(detail) => detail()}
            </Show>
          </ViewShell.Main>
        </ViewShell.Root>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}
