import { createDragAutoScroll } from '@app/components/drag-drop/create-drag-auto-scroll';
import {
  CollapsibleSection,
  SearchBar,
  ViewSidebar,
} from '@app/components/view-shell';
import { SIDEBAR_SECTION_DRAG_TYPE } from '@app/components/view-shell/core/section-order';
import { ConnectorImportSidebar } from '@app/features/connector-import/connector-import';
import { FavoriteContextMenu } from '@app/features/favorites/FavoriteContextMenu';
import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import { FavoriteUnreadIndicator } from '@app/features/favorites/FavoriteUnreadIndicator';
import { createFolderDropTargets } from '@app/features/next-soup/actions';
import { SidebarRoutineSuggestions } from '@app/features/routine-suggestions/routine-suggestions';
import { TutorialSidebarItem } from '@app/features/video-tutorials';
import { t } from '@app/lib/i18n';
import { useFavoriteDisplayName } from '@app/util/favorites';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { fireAndForget } from '@core/util/fireAndForget';
import { isEntityDragData } from '@entity';
import ClockIcon from '@icon/system/regular/clock.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import FolderPlusIcon from '@icon/system/regular/folder-plus.svg';
import HardDrivesIcon from '@icon/system/regular/hard-drives.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import StarIcon from '@icon/system/regular/star.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import UploadIcon from '@icon/system/regular/upload-simple.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { Button, cn } from '@ui';
import { createMemo, createSignal, createUniqueId, For, Show } from 'solid-js';
import { InlineNameInput } from '../../components/redesign/inline-name-input';
import { RedesignFolderTree } from '../../components/redesign/redesign-folder-tree';
import { useDriveView } from '../../context/drive-context';
import { useDriveRedesign } from '../../context/drive-redesign-context';
import type { DriveFolderMetadata } from '../../context/drive-source';
import {
  countDirectSubfolders,
  splitOwnedAndSharedFolders,
} from '../../core/drive-items';
import { buildFolderTree, filterFolderTree } from '../../core/folder-tree';
import type { DriveTab } from '../../core/types';
import { DriveLocationMenu } from '../../drive-location-menu';
import { DriveRedesignCreateMenu } from '../../drive-redesign-create-menu';
import { folderToProjectEntity } from '../shared/use-drive-display-items';

function DriveSidebarFavorite(props: {
  favorite: Favorite;
  onNavigate?: () => void;
}) {
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
        <FavoriteUnreadIndicator favorite={props.favorite} />
      </ViewSidebar.Item>
    </FavoriteContextMenu>
  );
}

function TrashNavDropItem(props: { active: boolean; onClick: () => void }) {
  const { host } = useDriveRedesign();
  const dragContext = useDragDropContext();
  const droppableId = `drive-sidebar-trash-drop-${createUniqueId()}`;

  const trashableEntities = (data: unknown) => {
    if (!isEntityDragData(data) || data.operation() !== 'move') return [];
    const dragged = data.selection?.entities() ?? [data];
    return dragged.filter((entity) => host.canMutateEntity(entity));
  };

  const droppable = dragContext
    ? createDroppable(droppableId, {
        isDropTargetDisabled: () =>
          trashableEntities(dragContext[0].active.draggable?.data).length === 0,
      })
    : undefined;

  if (dragContext) {
    const [, { onDragEnd }] = dragContext;
    onDragEnd(({ draggable, droppable: target }) => {
      if (target?.id !== droppableId) return;
      const data = draggable.data;
      const trashable = trashableEntities(data);
      if (trashable.length === 0) return;
      if (isEntityDragData(data)) data.selection?.clear();
      fireAndForget(
        host.trashEntitiesWithUndo(trashable),
        'drive-sidebar-trash-drop'
      );
    });
  }

  const isDragOverTrash = () => {
    if (!droppable?.isActiveDroppable || !dragContext) return false;
    return trashableEntities(dragContext[0].active.draggable?.data).length > 0;
  };

  return (
    <DriveLocationMenu location={{ kind: 'tab', tab: 'trash' }}>
      <div
        ref={(el) => droppable?.ref(el)}
        class={cn(
          'rounded-lg transition-colors',
          isDragOverTrash() &&
            'bg-failure/10 outline-2 -outline-offset-2 outline-failure-ink'
        )}
      >
        <ViewSidebar.Item active={props.active} onClick={props.onClick}>
          <ViewSidebar.Icon>
            <TrashIcon class="size-4 shrink-0" aria-hidden="true" />
          </ViewSidebar.Icon>
          <span class="truncate">{t('drive.trash')}</span>
        </ViewSidebar.Item>
      </div>
    </DriveLocationMenu>
  );
}

export function DriveRedesignSidebarContent(props: {
  onNavigate?: () => void;
}) {
  const { state, sidebar, actions } = useDriveView();
  const { inlineEdit, host } = useDriveRedesign();
  const panel = useSplitPanel();

  const createDropTarget = createFolderDropTargets({
    onMove: host.moveEntitiesWithUndo,
  });
  const rootDropTarget = createDropTarget?.(() => null);

  const [folderSearch, setFolderSearch] = createSignal('');
  const [searchingFolders, setSearchingFolders] = createSignal(false);

  const foldersById = createMemo(() => {
    const map = new Map<string, DriveFolderMetadata>();
    for (const folder of sidebar.folders()) map.set(folder.id, folder);
    return map;
  });

  const subfolderCounts = createMemo(() =>
    countDirectSubfolders(sidebar.folders())
  );

  const split = createMemo(() =>
    splitOwnedAndSharedFolders(sidebar.folders(), actions.userId())
  );

  const ownedTree = createMemo(() =>
    filterFolderTree(buildFolderTree(split().owned), folderSearch())
  );
  const sharedTree = createMemo(() =>
    filterFolderTree(buildFolderTree(split().shared), folderSearch())
  );

  const [sharedFoldersOpen, setSharedFoldersOpen] = createSignal(true);

  const selectedFolder = () => {
    const loc = state.value().location;
    return loc.kind === 'folder' ? loc.id : undefined;
  };

  const isTabActive = (tab: DriveTab) => {
    const loc = state.value().location;
    if (tab === 'owned' && loc.kind === 'folder' && loc.id === null) {
      return true;
    }
    return loc.kind === 'tab' && loc.tab === tab;
  };

  const navigateTab = (tab: DriveTab) => {
    state.selectTab(tab);
    props.onNavigate?.();
  };

  const selectFolder = (id: string | null) => {
    state.selectFolder(id);
    props.onNavigate?.();
  };

  const expandFolder = (id: string) => {
    if (!state.value().expandedFolderIds.includes(id)) {
      state.toggleFolder(id);
    }
  };

  const renamingSidebarId = () => {
    const target = inlineEdit.renaming();
    return target?.surface === 'sidebar' ? target.id : undefined;
  };

  const creatingSidebarParentId = () => {
    const target = inlineEdit.creatingFolder();
    return target?.surface === 'sidebar' ? target.parentId : undefined;
  };

  const commitSidebarRename = async (id: string, nextName: string) => {
    const folder = foldersById().get(id);
    if (!folder) {
      inlineEdit.cancelRename();
      return;
    }
    await inlineEdit.runCommit(() =>
      host.renameEntityInline(folderToProjectEntity(folder), nextName)
    );
  };

  const commitSidebarCreate = async (parentId: string | null, name: string) => {
    await inlineEdit.runCommit(async () => {
      if (parentId) expandFolder(parentId);
      await host.createFolderInline(name, parentId);
    });
  };

  return (
    <>
      <ViewSidebar.Section
        id="views"
        label={t('viewMenus.driveViews')}
        headerless
      >
        <ViewSidebar.Nav aria-label={t('viewMenus.driveViews')}>
          <DriveLocationMenu location={{ kind: 'tab', tab: 'owned' }}>
            <div
              ref={(el) => rootDropTarget?.ref(el)}
              class={cn(
                'rounded-lg transition-colors',
                rootDropTarget?.isOver() &&
                  'bg-accent/12 outline-2 -outline-offset-2 outline-accent'
              )}
            >
              <ViewSidebar.Item
                active={isTabActive('owned')}
                onClick={() => navigateTab('owned')}
              >
                <ViewSidebar.Icon>
                  <HardDrivesIcon class="size-4 shrink-0" aria-hidden="true" />
                </ViewSidebar.Icon>
                <span class="truncate">{t('drive.myDrive')}</span>
              </ViewSidebar.Item>
            </div>
          </DriveLocationMenu>

          <DriveLocationMenu location={{ kind: 'tab', tab: 'recent' }}>
            <ViewSidebar.Item
              active={isTabActive('recent')}
              onClick={() => navigateTab('recent')}
            >
              <ViewSidebar.Icon>
                <ClockIcon class="size-4 shrink-0" aria-hidden="true" />
              </ViewSidebar.Icon>
              <span class="truncate">{t('drive.recent')}</span>
            </ViewSidebar.Item>
          </DriveLocationMenu>

          <DriveLocationMenu location={{ kind: 'tab', tab: 'shared' }}>
            <ViewSidebar.Item
              active={isTabActive('shared')}
              onClick={() => navigateTab('shared')}
            >
              <ViewSidebar.Icon>
                <UsersIcon class="size-4 shrink-0" aria-hidden="true" />
              </ViewSidebar.Icon>
              <span class="truncate">{t('drive.sharedWithMe')}</span>
            </ViewSidebar.Item>
          </DriveLocationMenu>

          <DriveLocationMenu location={{ kind: 'tab', tab: 'starred' }}>
            <ViewSidebar.Item
              active={isTabActive('starred')}
              onClick={() => navigateTab('starred')}
            >
              <ViewSidebar.Icon>
                <StarIcon class="size-4 shrink-0" aria-hidden="true" />
              </ViewSidebar.Icon>
              <span class="min-w-0 flex-1 truncate">{t('drive.starred')}</span>
              <Show when={sidebar.favorites().length > 0}>
                <span class="shrink-0 text-[11px] tabular-nums text-ink-subtle">
                  {sidebar.favorites().length}
                </span>
              </Show>
            </ViewSidebar.Item>
          </DriveLocationMenu>

          <TrashNavDropItem
            active={isTabActive('trash')}
            onClick={() => navigateTab('trash')}
          />
        </ViewSidebar.Nav>
      </ViewSidebar.Section>

      <CollapsibleSection.Root
        sectionId="folders"
        sectionLabel={t('drive.myFolders')}
        open={state.value().rootOpen}
        onOpenChange={state.setRootOpen}
      >
        <CollapsibleSection.Header>
          <CollapsibleSection.Trigger class="flex-1">
            <span class="min-w-0 truncate">{t('drive.myFolders')}</span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
          <CollapsibleSection.Action
            aria-label={t('drive.newFolderInline')}
            onClick={() => {
              state.setRootOpen(true);
              inlineEdit.startCreateFolder({
                parentId: null,
                surface: 'sidebar',
              });
            }}
          >
            <FolderPlusIcon class="size-3.5" />
          </CollapsibleSection.Action>
          <CollapsibleSection.Action
            aria-label={t('drive.searchDrivePlaceholder')}
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
              label={t('drive.folders')}
              placeholder={t('drive.folders')}
              value={folderSearch()}
              onValueChange={setFolderSearch}
              class="mb-2"
            />
          </Show>
          <ViewSidebar.Nav aria-label={t('drive.myFolders')}>
            <Show when={creatingSidebarParentId() === null}>
              <div class="mb-0.5 flex h-(--sidebar-row-height) items-center gap-1.5 px-2">
                <FolderIcon class="size-4 shrink-0 text-accent" />
                <InlineNameInput
                  initialValue=""
                  isFolder
                  placeholder={t('drive.folderNamePlaceholder')}
                  ariaLabel={t('drive.newFolderInputLabel')}
                  disabled={inlineEdit.isPending()}
                  onCommit={(name) => commitSidebarCreate(null, name)}
                  onCancel={inlineEdit.cancelCreateFolder}
                />
              </div>
            </Show>
            <Show
              when={!sidebar.foldersLoading()}
              fallback={
                <p role="status" class="px-3 py-2 text-xs text-ink-muted">
                  {t('drive.loadingMore')}
                </p>
              }
            >
              <Show
                when={!sidebar.foldersError()}
                fallback={
                  <div class="flex flex-col items-start gap-1.5 p-3 text-xs text-ink-muted">
                    <span>{t('drive.loadFailed')}</span>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        fireAndForget(sidebar.retryFolders(), 'drive-redesign')
                      }
                    >
                      {t('drive.tryAgain')}
                    </Button>
                  </div>
                }
              >
                <RedesignFolderTree
                  nodes={ownedTree()}
                  foldersById={foldersById()}
                  subfolderCounts={subfolderCounts()}
                  selectedId={selectedFolder()}
                  expandedIds={state.value().expandedFolderIds}
                  searching={Boolean(folderSearch().trim())}
                  userId={actions.userId()}
                  splitId={panel?.handle.id}
                  locationMenu={DriveLocationMenu}
                  createDropTarget={createDropTarget}
                  renamingId={renamingSidebarId()}
                  creatingParentId={creatingSidebarParentId()}
                  inlinePending={inlineEdit.isPending()}
                  onToggle={state.toggleFolder}
                  onExpand={expandFolder}
                  onSelect={selectFolder}
                  onStartCreateSubfolder={(parentId) =>
                    inlineEdit.startCreateFolder({
                      parentId,
                      surface: 'sidebar',
                    })
                  }
                  onCommitRename={commitSidebarRename}
                  onCancelRename={inlineEdit.cancelRename}
                  onCommitCreateFolder={commitSidebarCreate}
                  onCancelCreateFolder={inlineEdit.cancelCreateFolder}
                />
                <Show
                  when={
                    ownedTree().length === 0 &&
                    creatingSidebarParentId() !== null
                  }
                >
                  <p class="px-3 py-1.5 text-xs text-ink-subtle">
                    {folderSearch().trim()
                      ? t('drive.emptySearchTitle')
                      : t('drive.emptyFolderTitle')}
                  </p>
                </Show>
              </Show>
            </Show>
          </ViewSidebar.Nav>
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>

      <Show when={split().shared.length > 0}>
        <CollapsibleSection.Root
          sectionId="shared-folders"
          sectionLabel={t('drive.sharedFolders')}
          open={sharedFoldersOpen()}
          onOpenChange={setSharedFoldersOpen}
        >
          <CollapsibleSection.Header>
            <CollapsibleSection.Trigger>
              <span class="min-w-0 truncate">{t('drive.sharedFolders')}</span>
              <CollapsibleSection.Indicator />
            </CollapsibleSection.Trigger>
          </CollapsibleSection.Header>
          <CollapsibleSection.Content>
            <ViewSidebar.Nav aria-label={t('drive.sharedFolders')}>
              <RedesignFolderTree
                nodes={sharedTree()}
                foldersById={foldersById()}
                subfolderCounts={subfolderCounts()}
                selectedId={selectedFolder()}
                expandedIds={state.value().expandedFolderIds}
                searching={Boolean(folderSearch().trim())}
                sharedSection
                userId={actions.userId()}
                splitId={panel?.handle.id}
                locationMenu={DriveLocationMenu}
                createDropTarget={createDropTarget}
                renamingId={renamingSidebarId()}
                inlinePending={inlineEdit.isPending()}
                onToggle={state.toggleFolder}
                onExpand={expandFolder}
                onSelect={selectFolder}
                onCommitRename={commitSidebarRename}
                onCancelRename={inlineEdit.cancelRename}
                onCommitCreateFolder={commitSidebarCreate}
                onCancelCreateFolder={inlineEdit.cancelCreateFolder}
              />
            </ViewSidebar.Nav>
          </CollapsibleSection.Content>
        </CollapsibleSection.Root>
      </Show>

      <Show when={sidebar.favorites().length > 0}>
        <CollapsibleSection.Root
          sectionId="favorites"
          sectionLabel={t('drive.favorites')}
          open={state.value().favoritesOpen}
          onOpenChange={state.setFavoritesOpen}
        >
          <CollapsibleSection.Header>
            <CollapsibleSection.Trigger>
              <span class="min-w-0 truncate">{t('drive.favorites')}</span>
              <CollapsibleSection.Indicator />
            </CollapsibleSection.Trigger>
          </CollapsibleSection.Header>
          <CollapsibleSection.Content>
            <ViewSidebar.Nav aria-label={t('drive.favorites')}>
              <For each={sidebar.favorites()}>
                {(favorite) => (
                  <DriveSidebarFavorite
                    favorite={favorite}
                    onNavigate={props.onNavigate}
                  />
                )}
              </For>
            </ViewSidebar.Nav>
          </CollapsibleSection.Content>
        </CollapsibleSection.Root>
      </Show>
    </>
  );
}

function DriveImportPromotion() {
  const { actions } = useDriveView();
  return (
    <ConnectorImportSidebar
      category="files"
      class="mt-auto"
      alternatives={[
        {
          icon: UploadIcon,
          label: t('drive.uploadFiles'),
          description: t('create.guideUploadFiles'),
          onSelect: actions.uploadFiles,
        },
        {
          icon: FolderIcon,
          label: t('drive.uploadFolder'),
          description: t('create.guideUploadFolder'),
          onSelect: actions.uploadFolder,
        },
      ]}
    />
  );
}

function DriveTutorials() {
  const { tutorials } = useDriveView();
  return (
    <ViewSidebar.Nav
      aria-label={t('tutorials.watchTutorial')}
      class="empty:hidden"
    >
      <For each={tutorials()}>
        {(id) => (
          <TutorialSidebarItem tutorial={id} named={tutorials().length > 1} />
        )}
      </For>
    </ViewSidebar.Nav>
  );
}

export function DriveRedesignSidebar(props: {
  onStartInlineFolder: () => void;
}) {
  const [content, setContent] = createSignal<HTMLDivElement>();
  const drag = useDragDropContext();
  if (drag) {
    const [dragState] = drag;
    createDragAutoScroll({
      getViewport: () => {
        if (
          dragState.active.draggable?.data.dragType ===
          SIDEBAR_SECTION_DRAG_TYPE
        ) {
          return;
        }
        return content();
      },
      axis: 'both',
    });
  }

  return (
    <ViewSidebar.Root reorderId="drive" aria-label="Drive navigation">
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <ViewSidebar.CloseButton />
          <ViewSidebar.Title>{t('drive.driveRoot')}</ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>
      <ViewSidebar.Primary>
        <DriveRedesignCreateMenu
          presentation="sidebar"
          onStartInlineFolder={props.onStartInlineFolder}
        />
      </ViewSidebar.Primary>
      <ViewSidebar.Content ref={setContent}>
        <SidebarRoutineSuggestions surface="files" />
        <DriveTutorials />
        <DriveRedesignSidebarContent />
        <DriveImportPromotion />
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
