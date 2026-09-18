import { entityDetailBlockType } from '@app/components/entity-detail/EntityDetail';
import {
  EntityDetailNavigationStack,
  type EntityDetailTarget,
  entityDetailTarget,
  useEntityDetailNavigationStack,
} from '@app/components/entity-detail/EntityDetailNavigationStack';
import {
  ListFilterDropdown,
  useViewControlHotkeys,
  useViewTabHotkeys,
  ViewBreadcrumbs,
  ViewSidebar,
} from '@app/components/view-shell';
import {
  CREATABLE_BLOCKS,
  runCreateAction,
  useCreatableEnabled,
} from '@app/features/command/Launcher';
import { FavoriteContextMenu } from '@app/features/favorites/FavoriteContextMenu';
import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import { makeShareAction } from '@app/features/next-soup/actions';
import type { Query } from '@app/features/next-soup/filters/filter-store';
import { queryStateFrom } from '@app/features/next-soup/filters/filter-store';
import type { SetPredicatesInput } from '@app/features/next-soup/filters/filter-store/predicates-store';
import { mergeQuery } from '@app/features/next-soup/filters/filter-store/query-store';
import { soupItemMatchesProjectMembership } from '@app/features/next-soup/filters/query-filters';
import { FilterSubmenu } from '@app/features/next-soup/soup-view/filters-bar/filter-menu';
import { UnifiedFilterDropdown } from '@app/features/next-soup/soup-view/filters-bar/unified-filter-dropdown';
import { SoupViewList } from '@app/features/next-soup/soup-view/soup-view';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  favoriteBlockName,
  favoriteSplitContent,
  useFavoriteDisplayName,
} from '@app/util/favorites';
import { useHandleFileUpload } from '@app/util/handleFileUpload';
import { SidebarOpenInSplitMenu } from '@components/app/app-sidebar/sidebar';
import { useEntryState } from '@components/app/split-layout/entry-state';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  handleFolderSelect,
  openFilePicker,
  openFolderPicker,
} from '@core/util/upload';
import EmptyStateFolderGraphic from '@design/empty-state-folder.svg';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import FolderIcon from '@phosphor/folder.svg';
import FilterIcon from '@phosphor/funnel-simple.svg';
import PlusIcon from '@phosphor/plus.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import UploadIcon from '@phosphor/upload-simple.svg';
import { TagSetsProvider } from '@property/tags/tag-sets-context';
import { useFavoritesData } from '@queries/favorites/favorites';
import { useProjectsQuery } from '@queries/storage/projects';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { Dropdown, EmptyStatePanel } from '@ui';
import { batch, createMemo, For, onCleanup, Show, Suspense } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { DriveLocationBreadcrumbItems } from './components/DriveBreadcrumbs';
import { DriveDetailView } from './components/DriveDetailView';
import type { DriveLocationMenu } from './components/drive-navigation';
import { driveLocationBreadcrumbs } from './core/breadcrumbs';
import { driveLocationLabel } from './core/location-label';
import {
  DRIVE_TABS,
  type DriveScope,
  type DriveState,
  type DriveTab,
} from './core/types';
import { DriveFolderActions } from './drive-folder-actions';
import { createDriveNavigation } from './primitives/drive-navigation';
import { driveFilterTab, driveQuery } from './queries/drive-query';
import { createDriveResults } from './queries/drive-results';
import { DriveLayout } from './views/drive-layout';

export type DriveViewProps = {
  initialFilters?: Query;
  initialClientFilters?: SetPredicatesInput<string>;
};

function favoriteDetailTarget(
  favorite: Favorite,
  fallbackName: string
): EntityDetailTarget | undefined {
  if (favorite.entityType !== 'document') return;

  const blockName = favoriteBlockName(favorite);
  const target = entityDetailTarget.document({
    id: favorite.entityId,
    fileType: favorite.fileType ?? undefined,
    subType:
      blockName === 'snippet' || blockName === 'skill'
        ? { type: blockName }
        : undefined,
    fallbackName,
  });
  return entityDetailBlockType(target) ? target : undefined;
}

function DriveFavorite(props: {
  favorite: Favorite;
  onOpen: (favorite: Favorite, name: string, event: MouseEvent) => void;
}) {
  const name = useFavoriteDisplayName(props.favorite);
  return (
    <FavoriteContextMenu favorite={props.favorite} triggerClass="block">
      <ViewSidebar.Item
        title={name()}
        onClick={(event) => props.onOpen(props.favorite, name(), event)}
      >
        <ViewSidebar.Icon>
          <FavoriteIcon favorite={props.favorite} class="size-4" />
        </ViewSidebar.Icon>
        <span class="truncate">{name()}</span>
      </ViewSidebar.Item>
    </FavoriteContextMenu>
  );
}

function DriveViewContent(props: DriveViewProps) {
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const navigationStack = useEntityDetailNavigationStack();
  const shareAction = makeShareAction();
  const userId = useUserId();
  const view = useSoupView();
  const projects = useProjectsQuery();
  const folders = () =>
    projects.isSuccess
      ? projects.data.filter((folder) => !folder.deletedAt)
      : [];
  const favoritesData = useFavoritesData();
  const favorites = createMemo(() =>
    (favoritesData()?.favorites ?? [])
      .filter(
        (favorite) =>
          favorite.entityType === 'project' ||
          (favorite.entityType === 'document' &&
            favorite.documentSubType !== 'task')
      )
      .sort((a, b) => a.sortOrder - b.sortOrder)
  );
  const [state, setState] = useEntryState<DriveState>('drive.view', {
    default: {
      location: { kind: 'tab', tab: 'owned' },
      scope: 'default',
      sort: 'updated_at',
      expandedFolderIds: [],
      favoritesOpen: true,
      rootOpen: true,
      tagsOpen: true,
    },
  });
  onCleanup(
    panel.handle.registerEntryStateCaptor('drive.returnLabel', () =>
      driveLocationLabel(state().location, folders())
    )
  );
  const projectId = () => {
    const location = state().location;
    return location.kind === 'folder' ? (location.id ?? undefined) : undefined;
  };
  const isRecent = () => {
    const location = state().location;
    return location.kind === 'tab' && location.tab === 'recent';
  };
  const upload = useHandleFileUpload({
    get projectId() {
      return projectId();
    },
  });
  const isCreatableEnabled = useCreatableEnabled();
  const createOptions = () =>
    CREATABLE_BLOCKS.filter(
      (block) =>
        ['md', 'snippet', 'spreadsheet', 'canvas', 'code', 'project'].includes(
          block.blockName
        ) && isCreatableEnabled(block.blockName)
    );

  /** Exit any inline detail so the list reflects the chosen location or tags. */
  const showList = () => {
    navigationStack.clear();
    panel.handle.resetPreview();
  };
  const { navigate, setScope } = createDriveNavigation({
    state,
    setState,
    folders,
    results: createDriveResults(view, userId),
    onNavigate: showList,
  });
  const selectTab = (tab: DriveTab) => navigate({ kind: 'tab', tab });
  const selectFolder = (id: string | null) => navigate({ kind: 'folder', id });
  const locationBreadcrumbs = createMemo(() =>
    driveLocationBreadcrumbs(state().location, folders())
  );

  const initial = driveQuery(state(), userId());
  view.initialize({
    initialQuery: props.initialFilters
      ? mergeQuery(queryStateFrom(initial.filters), props.initialFilters)
      : initial.filters,
    initialClientFilters: props.initialClientFilters ?? initial.clientFilters,
    initialSearchText: projectId() ? '' : view.searchText(),
    preferInitialFilters: true,
    sortMethod: () => (isRecent() ? 'touched_by_me' : undefined),
    persistFilters: false,
    itemMembershipFilter: (item) => {
      const id = projectId();
      return !id || soupItemMatchesProjectMembership(item, id);
    },
  });
  view.setActiveTab(driveFilterTab(state()));
  view.soup.grouping.setActiveGroupId(undefined);
  view.soup.sort.setAll([state().sort]);
  panel.handle.setDisplayName('Drive');
  let searchInput: HTMLInputElement | undefined;
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    search: {
      description: 'Search Drive',
      condition: () => !projectId() && !navigationStack.active(),
      run: () => {
        searchInput?.focus();
        searchInput?.select();
        return true;
      },
    },
  });
  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () => DRIVE_TABS.map((tab) => tab.id),
    activeId: () => {
      const location = state().location;
      return location.kind === 'tab' ? location.tab : 'owned';
    },
    setActiveId: selectTab,
  });

  const scopeOptions: { id: DriveScope; label: string }[] = [
    { id: 'default', label: 'Default' },
    { id: 'all', label: 'All files' },
    { id: 'attachments', label: 'Email attachments' },
  ];
  const FilterMenu = () => (
    <Show when={state().location.kind === 'tab'}>
      <Show
        when={!isRecent()}
        fallback={
          <ListFilterDropdown
            label="Filter files"
            groups={[
              {
                id: 'scope',
                label: 'Files',
                selectionMode: 'single',
                defaultOptionId: 'default',
                options: scopeOptions,
              },
            ]}
            isSelected={(_, id) => state().scope === id}
            onSelectionChange={(_, id) => setScope(id)}
          />
        }
      >
        <Suspense>
          <UnifiedFilterDropdown
            customTrigger={
              <Dropdown.Trigger
                variant="outline"
                size="md"
                square
                depth={2}
                class="rounded-lg bg-surface"
                label="Filter files"
              >
                <FilterIcon />
              </Dropdown.Trigger>
            }
          >
            <FilterSubmenu
              label="Files"
              active={state().scope !== 'default'}
              options={scopeOptions}
              isSelected={(id) => state().scope === id}
              onSelect={setScope}
              closeOnSelect
            />
          </UnifiedFilterDropdown>
        </Suspense>
      </Show>
    </Show>
  );

  const CreateMenu = () => (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger as={ViewSidebar.Action} aria-label="New file or folder">
        <ViewSidebar.Icon>
          <PlusIcon class="size-4" />
        </ViewSidebar.Icon>
        <span class="truncate">New</span>
        <ViewSidebar.Trailing>
          <CaretDownIcon class="size-3 shrink-0" />
        </ViewSidebar.Trailing>
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-48">
        <Dropdown.Group>
          <For each={createOptions()}>
            {(option) => (
              <Dropdown.Item
                onSelect={() =>
                  runCreateAction(option.blockName, {
                    projectId: projectId(),
                    source: 'drive',
                  })
                }
              >
                <span
                  aria-hidden="true"
                  class="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4"
                >
                  <Dynamic component={option.icon} />
                </span>
                <span>{option.label}</span>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
        <Dropdown.Group>
          <Dropdown.Item
            onSelect={() =>
              openFilePicker({ multiple: true }, async (files) => {
                await upload(files, false);
              })
            }
          >
            <UploadIcon aria-hidden="true" class="size-4 shrink-0" />
            <span>Upload files</span>
          </Dropdown.Item>
          <Dropdown.Item
            onSelect={() =>
              openFolderPicker({}, async (files) => {
                await handleFolderSelect(files, async (entries) => {
                  await upload(entries, false);
                });
              })
            }
          >
            <FolderIcon aria-hidden="true" class="size-4 shrink-0" />
            <span>Upload folder</span>
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );

  const Favorites = () => (
    <ViewSidebar.Nav aria-label="Favorite files and folders">
      <For each={favorites()}>
        {(favorite) => (
          <DriveFavorite
            favorite={favorite}
            onOpen={(item, name, event) => {
              const target = favoriteDetailTarget(item, name);
              if (item.entityType === 'project' && !event.shiftKey)
                selectFolder(item.entityId);
              else if (
                target &&
                navigationStack.shouldNavigate(target, { event })
              ) {
                navigationStack.reset(target);
                return;
              } else
                layout.openWithSplit(favoriteSplitContent(item), {
                  referredFrom: 'sidebar',
                  preferNewSplit: event.shiftKey,
                });
            }}
          />
        )}
      </For>
    </ViewSidebar.Nav>
  );

  const LocationMenu: DriveLocationMenu = (menuProps) => {
    const folder = () => {
      const location = menuProps.location;
      return location.kind === 'folder'
        ? folders().find((folder) => folder.id === location.id)
        : undefined;
    };
    const content = (): SplitContent => ({
      type: 'component',
      id: 'documents',
      state: {
        'drive.view': {
          ...state(),
          location: menuProps.location,
          scope: 'default',
        } satisfies DriveState,
      },
    });
    const openFullscreen = () => {
      const manager = globalSplitManager();
      if (!manager) return;

      // Keep this Drive instance so the chosen location is applied to its navigation.
      batch(() => {
        navigate(menuProps.location);
        for (const split of manager.splits()) {
          if (split.id !== panel.handle.id) manager.removeSplit(split.id);
        }
        manager.unSpotlightSplit();
        panel.handle.activate();
      });
    };

    return (
      <SidebarOpenInSplitMenu
        content={content}
        triggerClass="block h-auto"
        onOpenCurrentSplit={() => navigate(menuProps.location)}
        onOpenFullscreen={openFullscreen}
        additionalActions={
          <Show when={folder()}>
            {(folder) => <DriveFolderActions folder={folder()} />}
          </Show>
        }
      >
        {menuProps.children}
      </SidebarOpenInSplitMenu>
    );
  };

  return (
    <ViewBreadcrumbs.Root
      value={
        navigationStack.active()?.value ?? locationBreadcrumbs().at(-1)!.value
      }
      onChange={(value) => {
        const breadcrumb = locationBreadcrumbs().find(
          (entry) => entry.value === value
        );
        if (!breadcrumb) {
          navigationStack.popTo(value);
          return;
        }

        const current = state().location;
        const location = breadcrumb.location;
        const isCurrent =
          (current.kind === 'tab' &&
            location.kind === 'tab' &&
            current.tab === location.tab) ||
          (current.kind === 'folder' &&
            location.kind === 'folder' &&
            current.id === location.id);
        if (isCurrent) {
          navigationStack.clear();
          return;
        }
        navigate(location);
      }}
    >
      <DriveLocationBreadcrumbItems
        entries={locationBreadcrumbs()}
        folders={folders()}
        userId={userId()}
        onOpenFolderInNewSplit={
          !isTouchDevice() && globalSplitManager()?.canAppendSplit()
            ? (folder) =>
                layout.openWithSplit(
                  { type: 'project', id: folder.id },
                  {
                    preferNewSplit: true,
                    referredFrom: 'entity-actions-menu',
                  }
                )
            : undefined
        }
        onShareFolder={(folder) => void shareAction.execute(folder)}
        onDeleteFolder={(folder) => {
          const parentId = folders().some(({ id }) => id === folder.parentId)
            ? folder.parentId
            : null;
          selectFolder(parentId ?? null);
        }}
      />
      <TagSetsProvider tagSets={view.tagFilter.tagSets}>
        <DriveLayout
          locationMenu={LocationMenu}
          state={state()}
          folders={folders()}
          foldersLoading={projects.isPending}
          foldersError={projects.isError}
          onRetryFolders={() => void projects.refetch()}
          search={view.searchText()}
          onSearch={view.setSearchText}
          searchRef={(element) => {
            searchInput = element;
          }}
          onTab={selectTab}
          onFolder={selectFolder}
          filterMenu={FilterMenu}
          onSort={(sort) => {
            setState((current) => ({ ...current, sort }));
            view.soup.sort.setAll([sort]);
          }}
          onToggleFolder={(id) =>
            setState((current) => ({
              ...current,
              expandedFolderIds: current.expandedFolderIds.includes(id)
                ? current.expandedFolderIds.filter((value) => value !== id)
                : [...current.expandedFolderIds, id],
            }))
          }
          onFavoritesOpen={(favoritesOpen) =>
            setState((current) => ({ ...current, favoritesOpen }))
          }
          onRootOpen={(rootOpen) =>
            setState((current) => ({ ...current, rootOpen }))
          }
          activeTagIds={view.tagFilter.activeIds()}
          onTags={(ids) =>
            batch(() => {
              view.tagFilter.onChange(ids);
              showList();
            })
          }
          onTagsOpen={(tagsOpen) =>
            setState((current) => ({ ...current, tagsOpen }))
          }
          createMenu={CreateMenu}
          favorites={Favorites}
          hasFavorites={favorites().length > 0}
          detail={
            navigationStack.active() ? (
              <DriveDetailView
                breadcrumbOrderOffset={locationBreadcrumbs().length}
              />
            ) : undefined
          }
        >
          <Suspense
            fallback={
              <div class="grid size-full place-items-center text-ink-muted">
                <SpinnerIcon
                  aria-label="Loading files"
                  class="size-5 animate-spin"
                />
              </div>
            }
          >
            <SoupViewList
              emptyState={
                // A folder emptied by a tag filter is a filter miss, not a vacant folder.
                projectId() &&
                state().scope === 'default' &&
                view.tagFilter.activeIds().length === 0
                  ? () => (
                      <EmptyStatePanel
                        centered
                        graphic={EmptyStateFolderGraphic}
                        title="This folder is empty"
                        description="Create something new or drop files here to add them to this folder."
                        primaryAction={{
                          label: 'Back to Drive',
                          icon: ArrowLeftIcon,
                          onClick: () => selectFolder(null),
                        }}
                      />
                    )
                  : undefined
              }
              onOpenProject={selectFolder}
              onOpenEntity={(entity, event) => {
                if (entity.type !== 'document') return false;

                const target = entityDetailTarget.document({
                  id: entity.id,
                  fileType: entity.fileType,
                  subType: entity.subType,
                  fallbackName: entity.name,
                });
                if (!entityDetailBlockType(target)) return false;
                if (!navigationStack.shouldNavigate(target, { event }))
                  return false;
                navigationStack.reset(target);
                return true;
              }}
              uploadProjectId={projectId()}
              disableTabHotkeys
              navigationKey={JSON.stringify([state().location, state().scope])}
              timestamp={isRecent() ? (entity) => entity.touchedAt : undefined}
            />
          </Suspense>
        </DriveLayout>
      </TagSetsProvider>
    </ViewBreadcrumbs.Root>
  );
}

/** App composition: shared queries, inline details, and upload/create capabilities. */
export function DriveView(props: DriveViewProps) {
  return (
    <EntityDetailNavigationStack.Root>
      <DriveViewContent {...props} />
    </EntityDetailNavigationStack.Root>
  );
}
