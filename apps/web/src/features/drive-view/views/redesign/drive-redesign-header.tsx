import {
  useViewControlHotkeys,
  ViewSwitchTrigger,
} from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { createFolderDropTargets } from '@app/features/next-soup/actions';
import { t } from '@app/lib/i18n';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { fireAndForget } from '@core/util/fireAndForget';
import ShareIcon from '@icon/share.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import ColumnsIcon from '@icon/system/regular/columns.svg';
import DotsIcon from '@icon/system/regular/dots-three.svg';
import FolderPlusIcon from '@icon/system/regular/folder-plus.svg';
import ListIcon from '@icon/system/regular/list.svg';
import PencilIcon from '@icon/system/regular/pencil-line.svg';
import SidebarSimpleIcon from '@icon/system/regular/sidebar-simple.svg';
import SortAscIcon from '@icon/system/regular/sort-ascending.svg';
import SortDescIcon from '@icon/system/regular/sort-descending.svg';
import SquaresFourIcon from '@icon/system/regular/squares-four.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import { Button, ButtonGroup, Dropdown, Tabs } from '@ui';
import { createMemo, For, onCleanup, Show, Suspense } from 'solid-js';
import { ActiveFilterChips } from '../../components/redesign/active-filter-chips';
import {
  type RedesignBreadcrumbSegment,
  RedesignBreadcrumbs,
} from '../../components/redesign/redesign-breadcrumbs';
import { useDriveView } from '../../context/drive-context';
import { useDriveRedesign } from '../../context/drive-redesign-context';
import {
  type DriveRootBrowseMode,
  effectiveDesktopViewMode,
  supportsColumnsView,
} from '../../core/drive-view-mode';
import { folderAncestors } from '../../core/folder-tree';
import { DRIVE_SORT_OPTIONS, type DriveSort } from '../../core/types';
import { DriveRedesignCreateMenu } from '../../drive-redesign-create-menu';
import { DriveFilterMenu } from '../drive-filter-menu';
import {
  folderToProjectEntity,
  useDriveDisplayItems,
} from '../shared/use-drive-display-items';

export function DriveRedesignHeader(props: {
  onStartInlineFolder: () => void;
}) {
  const { state, sidebar, actions } = useDriveView();
  const { preferences, inlineEdit, inspector, host, registerFocusSearch } =
    useDriveRedesign();
  const display = useDriveDisplayItems();
  const panel = useSplitPanelOrThrow();
  const createDropTarget = createFolderDropTargets({
    onMove: host.moveEntitiesWithUndo,
  });

  let focusSearchFn: (() => void) | undefined;

  onCleanup(
    registerFocusSearch(() => {
      focusSearchFn?.();
    })
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

  const isRecent = () => {
    const loc = location();
    return loc.kind === 'tab' && loc.tab === 'recent';
  };

  const showColumnsToggle = () =>
    !isStarred() &&
    !isRecent() &&
    !isTrash() &&
    supportsColumnsView({
      location: location(),
      rootMode: preferences.rootMode(),
      isSearching: display.isSearching(),
      hasFilters: display.hasFilters(),
    });

  const activeViewMode = () =>
    effectiveDesktopViewMode(preferences.viewMode(), {
      location: location(),
      rootMode: preferences.rootMode(),
      isSearching: display.isSearching(),
      hasFilters: display.hasFilters(),
    });

  const activeFolderId = () => state.projectId();

  const activeFolder = createMemo(() => {
    const id = activeFolderId();
    if (!id) return undefined;
    return sidebar.folders().find((folder) => folder.id === id);
  });

  const ancestors = createMemo(() => {
    const id = activeFolderId();
    if (!id) return [];
    return folderAncestors(sidebar.folders(), id);
  });

  const parentFolder = createMemo(() => {
    const chain = ancestors();
    if (chain.length <= 1) return undefined;
    return chain[chain.length - 2];
  });

  const breadcrumbSegments = createMemo<RedesignBreadcrumbSegment[]>(() => {
    const chain = ancestors();
    if (chain.length === 0) return [];
    const rootSegment: RedesignBreadcrumbSegment = {
      id: 'drive-root',
      label: t('drive.myDrive'),
      folderId: null,
      onSelect: () => state.selectTab('owned'),
    };
    return [
      rootSegment,
      ...chain.map((folder) => ({
        id: folder.id,
        label: folder.name,
        folderId: folder.id,
        onSelect: () => state.selectFolder(folder.id),
      })),
    ];
  });

  const viewTitle = () => {
    const loc = location();
    if (loc.kind === 'folder') return t('drive.myDrive');
    switch (loc.tab) {
      case 'recent':
        return t('drive.recent');
      case 'shared':
        return t('drive.sharedWithMe');
      case 'starred':
        return t('drive.starred');
      case 'trash':
        return t('drive.trash');
      default:
        return t('drive.myDrive');
    }
  };

  const searchPlaceholder = () => {
    const folder = activeFolder();
    if (folder)
      return t('drive.searchFolderPlaceholder', { name: folder.name });
    if (isTrash()) return t('drive.searchTrashPlaceholder');
    if (isStarred()) return t('drive.searchStarredPlaceholder');
    return t('drive.searchDrivePlaceholder');
  };

  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () => panel.isPanelActive(),
    search: {
      description: t('drive.searchDrivePlaceholder'),
      run: () => {
        focusSearchFn?.();
        return true;
      },
    },
  });

  const showFilters = () => !isTrash() && !isStarred();
  const showViewModeControls = () => !isTrash();
  const showSortMenu = () => !isTrash() && !isRecent() && !isStarred();
  const showRootTabs = () =>
    display.isMyDriveRoot() && !display.isSearching() && !display.hasFilters();

  const currentSortDirectionIcon = () =>
    preferences.sortDirection() === 'asc' ? (
      <SortAscIcon class="size-4" aria-hidden="true" />
    ) : (
      <SortDescIcon class="size-4" aria-hidden="true" />
    );

  return (
    <>
      <ListHeader
        title={
          <div class="flex min-w-0 items-center gap-2.5">
            <Show
              when={activeFolder()}
              fallback={
                <>
                  <ViewSwitchTrigger
                    fallback={
                      <span class="truncate text-sm font-semibold tracking-[-0.02em] text-ink">
                        {viewTitle()}
                      </span>
                    }
                  >
                    {viewTitle()}
                  </ViewSwitchTrigger>
                  <Show when={showRootTabs()}>
                    <Tabs<DriveRootBrowseMode>
                      aria-label={t('drive.rootModeLabel')}
                      size="md"
                      value={preferences.rootMode()}
                      onChange={preferences.setRootMode}
                      options={[
                        { value: 'browse', label: t('drive.browseMode') },
                        { value: 'all', label: t('drive.allFilesMode') },
                      ]}
                    />
                  </Show>
                </>
              }
            >
              {(folder) => {
                const folderEntity = () => folderToProjectEntity(folder());
                const canMutate = () => host.canMutateEntity(folderEntity());
                return (
                  <RedesignBreadcrumbs
                    segments={breadcrumbSegments()}
                    createDropTarget={createDropTarget}
                    parentLabel={parentFolder()?.name ?? t('drive.myDrive')}
                    onNavigateUp={() => {
                      const parent = parentFolder();
                      if (parent) state.selectFolder(parent.id);
                      else state.selectTab('owned');
                    }}
                    trailingMenu={
                      <Dropdown placement="bottom-start">
                        <Dropdown.Trigger
                          as={Button}
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('drive.moreActions')}
                          tooltip={t('drive.moreActions')}
                        >
                          <DotsIcon class="size-4" aria-hidden="true" />
                        </Dropdown.Trigger>
                        <Dropdown.Content class="min-w-48">
                          <Show when={canMutate()}>
                            <Dropdown.Item
                              onSelect={() => props.onStartInlineFolder()}
                            >
                              <FolderPlusIcon
                                class="size-3.5 shrink-0"
                                aria-hidden="true"
                              />
                              <span>{t('drive.newSubfolder')}</span>
                            </Dropdown.Item>
                            <Dropdown.Item
                              onSelect={() =>
                                inlineEdit.startRename({
                                  id: folder().id,
                                  name: folder().name,
                                  isFolder: true,
                                  surface: 'sidebar',
                                })
                              }
                            >
                              <PencilIcon
                                class="size-3.5 shrink-0"
                                aria-hidden="true"
                              />
                              <span>{t('drive.rename')}</span>
                            </Dropdown.Item>
                          </Show>
                          <Dropdown.Item
                            onSelect={() =>
                              host.shareEntities([folderEntity()])
                            }
                          >
                            <ShareIcon
                              class="size-3.5 shrink-0"
                              aria-hidden="true"
                            />
                            <span>{t('drive.share')}</span>
                          </Dropdown.Item>
                          <Show when={actions.canOpenNewSplit()}>
                            <Dropdown.Item
                              onSelect={() =>
                                host.openFolderInNewSplit(folderEntity())
                              }
                            >
                              <ColumnsIcon
                                class="size-3.5 shrink-0"
                                aria-hidden="true"
                              />
                              <span>{t('drive.openInNewSplit')}</span>
                            </Dropdown.Item>
                          </Show>
                          <Show when={canMutate()}>
                            <Dropdown.Separator />
                            <Dropdown.Item
                              class="text-failure-ink"
                              onSelect={() => {
                                const parent = parentFolder();
                                const trashAndLeave = async () => {
                                  const ok = await host.trashEntitiesWithUndo([
                                    folderEntity(),
                                  ]);
                                  if (!ok) return;
                                  if (parent) state.selectFolder(parent.id);
                                  else state.selectTab('owned');
                                };
                                fireAndForget(
                                  trashAndLeave(),
                                  'drive-header-trash-folder'
                                );
                              }}
                            >
                              <TrashIcon
                                class="size-3.5 shrink-0"
                                aria-hidden="true"
                              />
                              <span>{t('drive.moveToTrash')}</span>
                            </Dropdown.Item>
                          </Show>
                        </Dropdown.Content>
                      </Dropdown>
                    }
                  />
                );
              }}
            </Show>
          </div>
        }
      >
        <Show when={showFilters()}>
          <HeaderActionGroup label={t('drive.viewOptions')} size="md">
            <Suspense>
              <DriveFilterMenu grouped />
            </Suspense>
          </HeaderActionGroup>
        </Show>

        <Show when={showViewModeControls()}>
          <HeaderActionGroup label={t('drive.viewModeLabel')} size="md">
            <ButtonGroup.Button
              size="icon-md"
              aria-label={t('drive.viewList')}
              tooltip={t('drive.viewList')}
              aria-pressed={activeViewMode() === 'list'}
              onClick={() => preferences.setViewMode('list')}
            >
              <ListIcon class="size-4" aria-hidden="true" />
            </ButtonGroup.Button>
            <ButtonGroup.Button
              size="icon-md"
              aria-label={t('drive.viewGrid')}
              tooltip={t('drive.viewGrid')}
              aria-pressed={activeViewMode() === 'grid'}
              onClick={() => preferences.setViewMode('grid')}
            >
              <SquaresFourIcon class="size-4" aria-hidden="true" />
            </ButtonGroup.Button>
            <Show when={showColumnsToggle()}>
              <ButtonGroup.Button
                size="icon-md"
                aria-label={t('drive.viewColumns')}
                tooltip={t('drive.viewColumns')}
                aria-pressed={activeViewMode() === 'columns'}
                onClick={() => preferences.setViewMode('columns')}
              >
                <ColumnsIcon class="size-4" aria-hidden="true" />
              </ButtonGroup.Button>
            </Show>

            <Show when={showSortMenu()}>
              <Dropdown placement="bottom-end">
                <Dropdown.Trigger
                  as={ButtonGroup.Button}
                  size="icon-md"
                  aria-label={t('drive.sortBy')}
                  tooltip={t('drive.sortBy')}
                >
                  {currentSortDirectionIcon()}
                </Dropdown.Trigger>
                <Dropdown.Content class="min-w-48">
                  <Dropdown.Group>
                    <Dropdown.GroupLabel>
                      {t('drive.sortBy')}
                    </Dropdown.GroupLabel>
                    <Dropdown.RadioGroup
                      value={state.value().sort}
                      onChange={(value) => state.setSort(value as DriveSort)}
                    >
                      <For each={DRIVE_SORT_OPTIONS}>
                        {(option) => (
                          <Dropdown.RadioItem value={option.id} closeOnSelect>
                            <span class="flex-1">{option.label}</span>
                            <Dropdown.ItemIndicator>
                              <CheckIcon class="size-3.5 text-accent" />
                            </Dropdown.ItemIndicator>
                          </Dropdown.RadioItem>
                        )}
                      </For>
                    </Dropdown.RadioGroup>
                  </Dropdown.Group>
                  <Dropdown.Separator />
                  <Dropdown.Group>
                    <Dropdown.GroupLabel>
                      {t('drive.displayOptions')}
                    </Dropdown.GroupLabel>
                    <Dropdown.Item
                      onSelect={() => preferences.toggleSortDirection()}
                    >
                      <span class="flex-1">
                        {preferences.sortDirection() === 'asc'
                          ? t('drive.sortDirectionAsc')
                          : t('drive.sortDirectionDesc')}
                      </span>
                      {currentSortDirectionIcon()}
                    </Dropdown.Item>
                    <Dropdown.CheckboxItem
                      checked={preferences.foldersFirst()}
                      onChange={preferences.setFoldersFirst}
                    >
                      <span class="flex-1">{t('drive.foldersFirst')}</span>
                      <Dropdown.ItemIndicator>
                        <CheckIcon class="size-3.5 text-accent" />
                      </Dropdown.ItemIndicator>
                    </Dropdown.CheckboxItem>
                  </Dropdown.Group>
                </Dropdown.Content>
              </Dropdown>
            </Show>

            <ButtonGroup.Button
              size="icon-md"
              aria-label={
                inspector.isOpen()
                  ? t('drive.hideInspector')
                  : t('drive.showInspector')
              }
              tooltip={`${t('drive.quickLook')} (Space)`}
              aria-pressed={inspector.isOpen()}
              onClick={inspector.toggle}
            >
              <SidebarSimpleIcon class="size-4" aria-hidden="true" />
            </ButtonGroup.Button>
          </HeaderActionGroup>
        </Show>

        <Show when={!isTrash()}>
          <DriveRedesignCreateMenu
            presentation="toolbar"
            onStartInlineFolder={props.onStartInlineFolder}
          />
        </Show>

        <ListHeaderSearch
          label={t('drive.searchDrivePlaceholder')}
          placeholder={searchPlaceholder()}
          value={state.value().search}
          focusResults={() => panel.panelRef()?.focus()}
          onValueChange={state.setSearch}
          registerFocus={(focus) => {
            focusSearchFn = focus;
          }}
        />
      </ListHeader>

      <Show when={display.isSearching() ? activeFolder() : undefined}>
        {(folder) => (
          <div class="flex shrink-0 items-center gap-2 border-b border-edge-muted bg-panel/60 px-4 py-1.5 text-xs text-ink-muted">
            <span class="truncate">
              {t('drive.searchingInFolder', { name: folder().name })}
            </span>
            <span aria-hidden="true" class="text-ink-subtle">
              ·
            </span>
            <Button
              variant="ghost"
              size="xs"
              class="shrink-0 text-xs font-medium text-accent hover:text-accent"
              onClick={() => {
                const query = state.value().search;
                state.selectTab('owned');
                state.setSearch(query);
              }}
            >
              {t('drive.searchAllDrive')}
            </Button>
          </div>
        )}
      </Show>

      <Show when={showFilters()}>
        <ActiveFilterChips
          chips={display.activeFilterChips()}
          onClearAll={state.clearFilters}
        />
      </Show>
    </>
  );
}
