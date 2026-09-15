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
import CaretRightIcon from '@phosphor/caret-right.svg';
import FolderIcon from '@phosphor/folder.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { Button, cn, Dropdown } from '@ui';
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
          <CollapsibleSection.Indicator class="order-first ml-0" />
          Favorites
        </CollapsibleSection.Trigger>
        <CollapsibleSection.Content>
          <props.favorites />
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>
      <section aria-label="Folders" class="min-w-0">
        <div class="mb-3 flex h-7 items-center justify-between px-3 text-xs text-ink-muted">
          <span>Folders</span>
          <Button
            variant="ghost"
            size="sm"
            square
            class="size-7 rounded-lg"
            aria-label="Search folders"
            onClick={() => {
              setSearchingFolders((value) => !value);
              setFolderSearch('');
            }}
          >
            <SearchIcon class="size-4" />
          </Button>
        </div>
        <Show when={searchingFolders()}>
          <SearchBar
            label="Search folders"
            placeholder="Search folders"
            value={folderSearch()}
            onValueChange={setFolderSearch}
            class="mb-2"
          />
        </Show>
        <div
          class={cn(
            'flex min-w-0 items-center rounded-xl',
            selectedFolder() === null ? 'bg-active' : 'hover:bg-hover'
          )}
        >
          <Button
            variant="ghost"
            size="sm"
            square
            class="size-6 shrink-0 rounded-lg not-disabled:hover:bg-transparent not-disabled:hover:bg-none not-disabled:active:bg-none"
            aria-label={
              props.state.rootOpen
                ? 'Collapse Drive folders'
                : 'Expand Drive folders'
            }
            aria-expanded={props.state.rootOpen}
            onClick={() => props.onRootOpen(!props.state.rootOpen)}
          >
            <CaretRightIcon
              class={cn(
                'size-3 transition-transform',
                props.state.rootOpen && 'rotate-90'
              )}
            />
          </Button>
          <ViewSidebar.Item
            class={cn(
              'min-w-0 flex-1 px-2 font-normal bg-transparent not-disabled:hover:bg-transparent not-disabled:hover:bg-none not-disabled:active:bg-none',
              selectedFolder() === null && 'text-ink'
            )}
            aria-current={selectedFolder() === null ? 'page' : undefined}
            onClick={() => {
              props.onFolder(null);
              setNavigationOpen(false);
            }}
          >
            <FolderIcon class="size-4 shrink-0" />
            <span>Drive</span>
          </ViewSidebar.Item>
        </div>
        <Show when={props.state.rootOpen || folderSearch().trim()}>
          <div class="ml-3 border-l border-edge pl-3">
            <Show
              when={!props.foldersLoading}
              fallback={
                <p role="status" class="px-3 py-2 text-sm text-ink-extra-muted">
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
                    {folderSearch() ? 'No matching folders' : 'No folders yet'}
                  </p>
                </Show>
              </Show>
            </Show>
          </div>
        </Show>
      </section>
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
                <SplitPanel.ControlGroup>
                  <SplitPanel.BackButton />
                  <SplitPanel.ForwardButton />
                </SplitPanel.ControlGroup>
              </ViewSidebar.Header>
              <ViewSidebar.Content class="flex flex-col gap-6">
                <props.createMenu />
                <SidebarContent />
              </ViewSidebar.Content>
            </ViewSidebar.Root>
          </ViewShell.Aside>
          <ViewShell.Main>
            <ViewShell.TopBar class="touch:flex">
              <Show
                when={props.state.location.kind === 'folder'}
                fallback={title()}
              >
                <span
                  role="navigation"
                  aria-label="Folder breadcrumbs"
                  class="inline-flex max-w-full items-center gap-1 overflow-x-auto align-middle"
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
                  <SplitPanel.ControlGroup>
                    <SplitPanel.CloseButton />
                    <SplitPanel.BackButton />
                    <SplitPanel.ForwardButton />
                  </SplitPanel.ControlGroup>
                  <Dropdown
                    open={navigationOpen()}
                    onOpenChange={setNavigationOpen}
                    placement="bottom-start"
                  >
                    <Dropdown.Trigger
                      variant="ghost"
                      class="min-w-0 gap-1 rounded-lg text-lg font-semibold"
                      aria-label="Select Drive view"
                    >
                      <span class="truncate">{title()}</span>
                      <CaretDownIcon class="size-3 shrink-0" />
                    </Dropdown.Trigger>
                    <Dropdown.Content class="max-h-[70vh] w-72 overflow-auto rounded-2xl p-3">
                      <div class="flex flex-col gap-5">
                        <SidebarContent />
                      </div>
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
