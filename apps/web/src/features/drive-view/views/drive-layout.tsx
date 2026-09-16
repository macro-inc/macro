import {
  CollapsibleSection,
  ListFilterDropdown,
  ListSortDropdown,
  SearchBar,
  ViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import { SplitPanel } from '@components/app/split-panel';
import CaretDownIcon from '@phosphor/caret-down.svg';
import FolderIcon from '@phosphor/folder.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { Button, Dropdown } from '@ui';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { DriveNavigation } from '../components/drive-navigation';
import { FolderTree } from '../components/folder-tree';
import {
  buildFolderTree,
  filterFolderTree,
  folderAncestors,
} from '../core/folder-tree';
import {
  DRIVE_TABS,
  type DriveFolder,
  type DriveScope,
  type DriveSort,
  type DriveState,
  type DriveTab,
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
  onScope: (scope: DriveScope) => void;
  onSort: (sort: DriveSort) => void;
  onToggleFolder: (id: string) => void;
  onFavoritesOpen: (open: boolean) => void;
  onRootOpen: (open: boolean) => void;
  createMenu: () => JSX.Element;
  favorites: () => JSX.Element;
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
  const breadcrumbs = createMemo(() => {
    const id = selectedFolder();
    return id ? folderAncestors(props.folders, id) : [];
  });
  const title = () =>
    props.state.location.kind === 'folder'
      ? (breadcrumbs().at(-1)?.name ?? 'Drive')
      : (DRIVE_TABS.find(
          (tab) =>
            props.state.location.kind === 'tab' &&
            tab.id === props.state.location.tab
        )?.label ?? 'My Files');

  const SidebarContent = () => (
    <>
      <DriveNavigation
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
        <CollapsibleSection.Trigger class="text-xs">
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
        <div class="flex items-center gap-1">
          <CollapsibleSection.Trigger class="min-w-0 flex-1 text-xs">
            <span class="min-w-0 truncate">Folders</span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
          <Button
            variant="ghost"
            size="icon-sm"
            label="Search folders"
            class="ml-auto mr-2 shrink-0 rounded-lg"
            onClick={() => {
              const open = !searchingFolders();
              setSearchingFolders(open);
              setFolderSearch('');
              if (open) props.onRootOpen(true);
            }}
          >
            <SearchIcon class="size-3.5" />
          </Button>
        </div>
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
            <div class="ml-3 border-l border-edge pl-3">
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
            </div>
          </ViewSidebar.Nav>
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>
    </>
  );

  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <ViewShell.Root
          resizable
          aside={{ preserveDuringResize: false }}
          main={{ preferredWidth: 640 }}
        >
          <ViewShell.Aside>
            <ViewSidebar.Root
              aria-label="Drive navigation"
              class="gap-4 bg-panel"
            >
              <ViewSidebar.Header>
                <div class="flex min-w-0 items-center gap-1">
                  <SplitPanel.CloseButton />
                  <ViewSidebar.Title>Drive</ViewSidebar.Title>
                </div>
              </ViewSidebar.Header>
              <ViewSidebar.Content class="flex flex-col gap-6">
                <props.createMenu />
                <SidebarContent />
              </ViewSidebar.Content>
            </ViewSidebar.Root>
          </ViewShell.Aside>
          <ViewShell.Main>
            <ViewShell.TopBar class="touch:flex">
              <SplitPanel.CloseButton class="hidden shrink-0 @max-[720px]/view-shell:flex" />
              <h1 class="hidden min-w-0 truncate text-sm font-semibold tracking-[-0.03em] text-ink @max-[720px]/view-shell:block">
                Drive
              </h1>
              <Show
                when={props.state.location.kind === 'folder'}
                fallback={
                  <h1 class="min-w-0 truncate text-sm font-semibold tracking-[-0.03em] text-ink @max-[720px]/view-shell:hidden">
                    {title()}
                  </h1>
                }
              >
                <span
                  role="navigation"
                  aria-label="Folder breadcrumbs"
                  class="inline-flex max-w-full items-center gap-1 overflow-x-auto align-middle @max-[720px]/view-shell:hidden"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    class="text-sm font-semibold tracking-[-0.03em] text-ink"
                    onClick={() => props.onFolder(null)}
                  >
                    Drive
                  </Button>
                  <For each={breadcrumbs()}>
                    {(folder) => (
                      <>
                        <span
                          aria-hidden="true"
                          class="shrink-0 text-ink-extra-muted"
                        >
                          /
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          class="max-w-48 shrink-0 truncate rounded-md px-1.5 text-sm font-semibold tracking-[-0.03em] text-ink"
                          title={folder.name}
                          onClick={() => props.onFolder(folder.id)}
                        >
                          {folder.name}
                        </Button>
                      </>
                    )}
                  </For>
                </span>
              </Show>
            </ViewShell.TopBar>
            <ViewShell.Header>
              <div class="flex min-w-0 flex-col gap-3">
                <div class="hidden min-w-0 items-center gap-2 @max-[720px]/view-shell:flex">
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
                  <div class="ml-auto shrink-0">
                    <props.createMenu />
                  </div>
                </div>
                <div class="flex min-w-0 items-center justify-between gap-3">
                  <SearchBar
                    ref={props.searchRef}
                    label="Search Drive"
                    placeholder={
                      selectedFolder() ? 'Search this folder' : 'Search files'
                    }
                    value={props.search}
                    onValueChange={props.onSearch}
                    hotkey="cmd+f"
                    class="max-w-md flex-1"
                  />
                  <div class="flex shrink-0 items-center gap-2">
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
                    <Show when={props.state.location.kind === 'tab'}>
                      <ListFilterDropdown
                        label="Filter files"
                        groups={[
                          {
                            id: 'scope',
                            label: 'Files',
                            selectionMode: 'single',
                            defaultOptionId: 'default',
                            options: [
                              { id: 'default', label: 'Default' },
                              { id: 'all', label: 'All files' },
                              { id: 'attachments', label: 'Email attachments' },
                            ],
                          },
                        ]}
                        isSelected={(_, id) => props.state.scope === id}
                        onSelectionChange={(_, id) => props.onScope(id)}
                        onClear={() => props.onScope('default')}
                      />
                    </Show>
                  </div>
                </div>
              </div>
            </ViewShell.Header>
            <ViewShell.Content>{props.children}</ViewShell.Content>
          </ViewShell.Main>
        </ViewShell.Root>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}
