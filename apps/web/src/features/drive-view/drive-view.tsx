import {
  useViewControlHotkeys,
  useViewTabHotkeys,
  ViewSidebar,
} from '@app/components/view-shell';
import {
  CREATABLE_BLOCKS,
  runCreateAction,
  useCreatableEnabled,
} from '@app/features/command/Launcher';
import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import type { Query } from '@app/features/next-soup/filters/filter-store';
import { queryStateFrom } from '@app/features/next-soup/filters/filter-store';
import type { SetPredicatesInput } from '@app/features/next-soup/filters/filter-store/predicates-store';
import { mergeQuery } from '@app/features/next-soup/filters/filter-store/query-store';
import { soupItemMatchesProjectMembership } from '@app/features/next-soup/filters/query-filters';
import { SoupViewList } from '@app/features/next-soup/soup-view/soup-view';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import {
  favoriteSplitContent,
  useFavoriteDisplayName,
} from '@app/util/favorites';
import { useHandleFileUpload } from '@app/util/handleFileUpload';
import { useEntryState } from '@components/app/split-layout/entry-state';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useUserId } from '@core/context/user';
import {
  handleFolderSelect,
  openFilePicker,
  openFolderPicker,
} from '@core/util/upload';
import EmptyStateFolderGraphic from '@design/empty-state-folder.svg';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import FolderIcon from '@phosphor/folder.svg';
import PlusIcon from '@phosphor/plus.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import UploadIcon from '@phosphor/upload-simple.svg';
import { useFavoritesData } from '@queries/favorites/favorites';
import { useProjectsQuery } from '@queries/storage/projects';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { Dropdown, EmptyStatePanel } from '@ui';
import { createMemo, For, Show, Suspense } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { DRIVE_TABS, type DriveState, type DriveTab } from './core/types';
import { createDriveNavigation } from './primitives/drive-navigation';
import { driveQuery } from './queries/drive-query';
import { createDriveResults } from './queries/drive-results';
import { DriveLayout } from './views/drive-layout';

export type DriveViewProps = {
  initialFilters?: Query;
  initialClientFilters?: SetPredicatesInput<string>;
};

function DriveFavorite(props: {
  favorite: Favorite;
  onOpen: (favorite: Favorite, event: MouseEvent) => void;
}) {
  const name = useFavoriteDisplayName(props.favorite);
  return (
    <ViewSidebar.Item
      class="font-normal"
      title={name()}
      onClick={(event) => props.onOpen(props.favorite, event)}
    >
      <FavoriteIcon favorite={props.favorite} class="size-4 shrink-0" />
      <span class="truncate">{name()}</span>
    </ViewSidebar.Item>
  );
}

/** App composition: shared queries, split navigation, and upload/create capabilities. */
export function DriveView(props: DriveViewProps) {
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
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
    },
  });
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
        ['md', 'snippet', 'canvas', 'code', 'project'].includes(
          block.blockName
        ) && isCreatableEnabled(block.blockName)
    );

  const { navigate, setScope } = createDriveNavigation({
    state,
    setState,
    folders,
    results: createDriveResults(view, userId),
    onNavigate: () => panel.handle.resetPreview(),
  });
  const selectTab = (tab: DriveTab) => navigate({ kind: 'tab', tab });
  const selectFolder = (id: string | null) => navigate({ kind: 'folder', id });

  const initial = driveQuery(state(), userId());
  view.initialize({
    initialQuery: props.initialFilters
      ? mergeQuery(queryStateFrom(initial.filters), props.initialFilters)
      : initial.filters,
    initialClientFilters: props.initialClientFilters ?? initial.clientFilters,
    initialSearchText: view.searchText(),
    preferInitialFilters: true,
    sortMethod: () => (isRecent() ? 'touched_by_me' : undefined),
    persistFilters: false,
    itemMembershipFilter: (item) => {
      const id = projectId();
      return !id || soupItemMatchesProjectMembership(item, id);
    },
  });
  view.soup.grouping.setActiveGroupId(undefined);
  view.soup.sort.setAll([state().sort]);
  panel.handle.setDisplayName('Drive');
  let searchInput: HTMLInputElement | undefined;
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    search: {
      description: 'Search Drive',
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

  const CreateMenu = () => (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        variant="ghost"
        depth={2}
        class="h-10 w-full shrink-0 justify-start gap-3 rounded-xl bg-ink/5 px-3"
        aria-label="New file or folder"
      >
        <PlusIcon class="size-4 shrink-0" />
        <span>New</span>
        <CaretDownIcon class="ml-auto size-3 shrink-0" />
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
            onOpen={(item, event) => {
              if (item.entityType === 'project' && !event.shiftKey)
                selectFolder(item.entityId);
              else
                layout.openWithSplit(favoriteSplitContent(item), {
                  referredFrom: 'sidebar',
                  preferNewSplit: event.shiftKey,
                });
            }}
          />
        )}
      </For>
      <Show when={favorites().length === 0}>
        <p class="px-3 py-2 text-sm text-ink-extra-muted">No favorites yet</p>
      </Show>
    </ViewSidebar.Nav>
  );

  return (
    <DriveLayout
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
      onScope={setScope}
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
      createMenu={CreateMenu}
      favorites={Favorites}
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
            projectId() && state().scope === 'default'
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
          uploadProjectId={projectId()}
          disableTabHotkeys
          navigationKey={JSON.stringify([state().location, state().scope])}
          timestamp={isRecent() ? (entity) => entity.touchedAt : undefined}
        />
      </Suspense>
    </DriveLayout>
  );
}
