import {
  CollapsibleSection,
  SearchBar,
  ViewSidebar,
} from '@app/components/view-shell';
import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import { t } from '@app/lib/i18n';
import { useFavoriteDisplayName } from '@app/util/favorites';
import ClockIcon from '@icon/system/regular/clock.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import FolderPlusIcon from '@icon/system/regular/folder-plus.svg';
import HardDrivesIcon from '@icon/system/regular/hard-drives.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import StarIcon from '@icon/system/regular/star.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { Button } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
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

function MobileSidebarFavorite(props: {
  favorite: Favorite;
  onNavigate?: () => void;
}) {
  const { actions } = useDriveView();
  const name = useFavoriteDisplayName(props.favorite);

  return (
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
  );
}

/**
 * Touch Drive navigation sidebar (presented as a left sheet on phones and
 * collapsible rail on tablets via `ViewShell.Aside`). Keeps My Drive, Recent,
 * Shared with me, Starred, Trash, split My folders / Shared folders,
 * Favorites, and Databases within reach.
 */
export function DriveRedesignMobileSidebar(props: { onNavigate?: () => void }) {
  const { state, sidebar, actions } = useDriveView();
  const { inlineEdit, host } = useDriveRedesign();

  const [folderSearch, setFolderSearch] = createSignal('');
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [myFoldersOpen, setMyFoldersOpen] = createSignal(true);
  const [sharedFoldersOpen, setSharedFoldersOpen] = createSignal(true);
  const [favoritesOpen, setFavoritesOpen] = createSignal(true);

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

  const creatingSidebarParentId = () => {
    const target = inlineEdit.creatingFolder();
    return target?.surface === 'sidebar' ? target.parentId : undefined;
  };

  const renamingSidebarId = () => {
    const target = inlineEdit.renaming();
    return target?.surface === 'sidebar' ? target.id : undefined;
  };

  const commitSidebarRename = async (id: string, nextName: string) => {
    const folder = foldersById().get(id);
    if (!folder) {
      inlineEdit.cancelRename();
      return;
    }
    await inlineEdit.runCommit(async () => {
      await host.renameEntityInline(
        {
          type: 'project',
          id: folder.id,
          name: folder.name,
          ownerId: folder.userId,
        },
        nextName
      );
    });
  };

  const commitSidebarCreate = async (parentId: string | null, name: string) => {
    await inlineEdit.runCommit(async () => {
      await host.createFolderInline(name, parentId);
    });
  };

  return (
    <ViewSidebar.Root aria-label="Drive navigation">
      <ViewSidebar.Header>
        <ViewSidebar.Title>{t('drive.driveRoot')}</ViewSidebar.Title>
      </ViewSidebar.Header>

      <ViewSidebar.Content class="gap-3">
        {/* Primary Drive views */}
        <ViewSidebar.Nav aria-label="Drive views">
          <ViewSidebar.Item
            active={isTabActive('owned')}
            onClick={() => navigateTab('owned')}
          >
            <ViewSidebar.Icon>
              <HardDrivesIcon class="size-4 shrink-0" aria-hidden="true" />
            </ViewSidebar.Icon>
            <span class="truncate">{t('drive.myDrive')}</span>
          </ViewSidebar.Item>

          <ViewSidebar.Item
            active={isTabActive('recent')}
            onClick={() => navigateTab('recent')}
          >
            <ViewSidebar.Icon>
              <ClockIcon class="size-4 shrink-0" aria-hidden="true" />
            </ViewSidebar.Icon>
            <span class="truncate">{t('drive.recent')}</span>
          </ViewSidebar.Item>

          <ViewSidebar.Item
            active={isTabActive('shared')}
            onClick={() => navigateTab('shared')}
          >
            <ViewSidebar.Icon>
              <UsersIcon class="size-4 shrink-0" aria-hidden="true" />
            </ViewSidebar.Icon>
            <span class="truncate">{t('drive.sharedWithMe')}</span>
          </ViewSidebar.Item>

          <ViewSidebar.Item
            active={isTabActive('starred')}
            onClick={() => navigateTab('starred')}
          >
            <ViewSidebar.Icon>
              <StarIcon class="size-4 shrink-0" aria-hidden="true" />
            </ViewSidebar.Icon>
            <span class="min-w-0 flex-1 truncate">{t('drive.starred')}</span>
            <Show when={sidebar.favorites().length > 0}>
              <span class="shrink-0 text-xs tabular-nums text-ink-subtle">
                {sidebar.favorites().length}
              </span>
            </Show>
          </ViewSidebar.Item>

          <ViewSidebar.Item
            active={isTabActive('trash')}
            onClick={() => navigateTab('trash')}
          >
            <ViewSidebar.Icon>
              <TrashIcon class="size-4 shrink-0" aria-hidden="true" />
            </ViewSidebar.Icon>
            <span class="truncate">{t('drive.trash')}</span>
          </ViewSidebar.Item>
        </ViewSidebar.Nav>

        {/* My folders */}
        <CollapsibleSection.Root
          sectionId="mobile-my-folders"
          sectionLabel={t('drive.myFolders')}
          open={myFoldersOpen()}
          onOpenChange={setMyFoldersOpen}
        >
          <CollapsibleSection.Header>
            <CollapsibleSection.Trigger>
              <span class="min-w-0 truncate">{t('drive.myFolders')}</span>
              <CollapsibleSection.Indicator />
            </CollapsibleSection.Trigger>
            <div class="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('drive.newFolderInline')}
                onClick={(event) => {
                  event.stopPropagation();
                  setMyFoldersOpen(true);
                  inlineEdit.startCreateFolder({
                    parentId: null,
                    surface: 'sidebar',
                  });
                }}
              >
                <FolderPlusIcon class="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Search folders"
                onClick={(event) => {
                  event.stopPropagation();
                  setSearchOpen((prev) => {
                    if (prev) setFolderSearch('');
                    return !prev;
                  });
                }}
              >
                <SearchIcon class="size-4" aria-hidden="true" />
              </Button>
            </div>
          </CollapsibleSection.Header>

          <Show when={searchOpen()}>
            <div class="px-2 pb-1.5">
              <SearchBar
                label="Search folders"
                placeholder="Filter folders"
                value={folderSearch()}
                onValueChange={setFolderSearch}
              />
            </div>
          </Show>

          <CollapsibleSection.Content>
            <ViewSidebar.Nav aria-label={t('drive.myFolders')}>
              <Show when={creatingSidebarParentId() === null}>
                <div class="flex min-h-11 items-center gap-2 px-2">
                  <FolderIcon class="size-4 shrink-0 text-ink-muted" />
                  <InlineNameInput
                    initialValue=""
                    isFolder
                    placeholder={t('drive.folderNamePlaceholder')}
                    ariaLabel={t('drive.newFolderInputLabel')}
                    disabled={inlineEdit.isPending()}
                    onCommit={(name) =>
                      inlineEdit.runCommit(async () => {
                        await host.createFolderInline(name, null);
                      })
                    }
                    onCancel={inlineEdit.cancelCreateFolder}
                  />
                </div>
              </Show>
              <RedesignFolderTree
                nodes={ownedTree()}
                foldersById={foldersById()}
                subfolderCounts={subfolderCounts()}
                selectedId={selectedFolder()}
                expandedIds={state.value().expandedFolderIds}
                searching={Boolean(folderSearch().trim())}
                userId={actions.userId()}
                locationMenu={DriveLocationMenu}
                renamingId={renamingSidebarId()}
                creatingParentId={creatingSidebarParentId()}
                inlinePending={inlineEdit.isPending()}
                onSelect={selectFolder}
                onToggle={state.toggleFolder}
                onExpand={expandFolder}
                onCommitCreateFolder={commitSidebarCreate}
                onCancelCreateFolder={inlineEdit.cancelCreateFolder}
                onCommitRename={commitSidebarRename}
                onCancelRename={inlineEdit.cancelRename}
              />
            </ViewSidebar.Nav>
          </CollapsibleSection.Content>
        </CollapsibleSection.Root>

        {/* Shared folders */}
        <Show when={split().shared.length > 0}>
          <CollapsibleSection.Root
            sectionId="mobile-shared-folders"
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
                  locationMenu={DriveLocationMenu}
                  onSelect={selectFolder}
                  onToggle={state.toggleFolder}
                  onExpand={expandFolder}
                  onCommitCreateFolder={commitSidebarCreate}
                  onCancelCreateFolder={inlineEdit.cancelCreateFolder}
                  onCommitRename={commitSidebarRename}
                  onCancelRename={inlineEdit.cancelRename}
                />
              </ViewSidebar.Nav>
            </CollapsibleSection.Content>
          </CollapsibleSection.Root>
        </Show>

        {/* Favorites */}
        <Show when={sidebar.favorites().length > 0}>
          <CollapsibleSection.Root
            sectionId="mobile-favorites"
            sectionLabel={t('drive.favorites')}
            open={favoritesOpen()}
            onOpenChange={setFavoritesOpen}
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
                    <MobileSidebarFavorite
                      favorite={favorite}
                      onNavigate={props.onNavigate}
                    />
                  )}
                </For>
              </ViewSidebar.Nav>
            </CollapsibleSection.Content>
          </CollapsibleSection.Root>
        </Show>
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
