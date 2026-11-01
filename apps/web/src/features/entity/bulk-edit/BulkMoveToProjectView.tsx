import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import { openFolderIds } from '@components/app/split-layout/open-folders';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { fireAndForget } from '@core/util/fireAndForget';
import FolderIcon from '@icon/system/regular/folder.svg';
import FolderPlusIcon from '@icon/system/regular/folder-plus.svg';
import { createFolderList } from '@queries/storage/folder-list';
import { createProject } from '@queries/storage/projects';
import {
  Button,
  CommandMenuEmptyState,
  CommandMenuList,
  CommandMenuSearchInput,
  CommandMenuShell,
  createCommandListController,
  Dialog,
} from '@ui';
import {
  createMemo,
  createSignal,
  createUniqueId,
  onMount,
  Show,
} from 'solid-js';
import { match } from 'ts-pattern';
import type { EntityData } from '../types/entity';
import { EntityActionSelection } from './components/EntityActionSelection';
import {
  entitiesToMove,
  type FolderGroup,
  type FolderPickerItem,
  folderDestinations,
  folderPickerItems,
  indexFolders,
} from './folder-destinations';
import { createMoveEntitiesToFolder } from './move-entities-to-folder';

const groupLabel = (group: FolderGroup) =>
  match(group)
    .with('open', () => t('entityActions.movePickerOpenInSplit'))
    .with('created', () => t('entityActions.movePickerCreatedByYou'))
    .with('shared', () => t('entityActions.movePickerSharedWithYou'))
    .exhaustive();

export type MovedFolder = { id: string; name: string };

export const BulkMoveToProjectView = (props: {
  entities: EntityData[];
  onMoved: (folder: MovedFolder) => void;
  onCancel: () => void;
  onError?: (error: unknown) => void;
}) => {
  const id = createUniqueId();
  const userId = useUserId();
  const folderList = createFolderList();
  const moveEntities = createMoveEntitiesToFolder('bulk_move');
  const [attachHotkeys] = useHotkeyDOMScope('bulk-move-to-project', true);
  let searchInput!: HTMLInputElement;
  onMount(() => attachHotkeys(searchInput));
  const [query, setQuery] = createSignal('');
  const [isPending, setIsPending] = createSignal(false);

  const destinations = createMemo(() =>
    folderDestinations({
      folders: folderList.folders(),
      openFolderIds: openFolderIds(globalSplitManager()),
      userId: userId(),
      entities: props.entities,
    })
  );
  const items = createMemo(() => folderPickerItems(destinations(), query()));

  const newFolder = async (name: string) => {
    const folderId = await createProject({ name, source: 'bulk_move' });
    if (!folderId) toast.failure(t('create.failedToCreateFolder'));
    return folderId ? { id: folderId, name } : undefined;
  };

  const moveTo = async (item: FolderPickerItem) => {
    setIsPending(true);
    try {
      const folder = item.kind === 'folder' ? item : await newFolder(item.name);
      if (!folder) return;
      await moveEntities(
        entitiesToMove(
          props.entities,
          folder.id,
          indexFolders(folderList.folders())
        ),
        folder
      );
      props.onMoved(folder);
    } catch (error) {
      console.error('Failed to move entities to folder:', error);
      props.onError?.(error);
    } finally {
      setIsPending(false);
    }
  };

  const select = (item: FolderPickerItem) => {
    if (!isPending()) fireAndForget(moveTo(item), 'bulk-move-to-project');
  };

  const list = createCommandListController({ items, onSelect: select });

  return (
    <CommandMenuShell>
      <CommandMenuShell.Header>
        <CommandMenuSearchInput
          ref={searchInput}
          aria-label={t('entityActions.movePickerSearch')}
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-folders`}
          aria-activedescendant={
            items().length ? `${id}-${list.selectedIndex()}` : undefined
          }
          placeholder={t('entityActions.movePickerSearch')}
          value={query()}
          disabled={isPending()}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            list.setSelectedIndex(0);
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'ArrowDown' ||
              (event.ctrlKey && event.key === 'j')
            ) {
              event.preventDefault();
              list.selectNext();
            }
            if (
              event.key === 'ArrowUp' ||
              (event.ctrlKey && event.key === 'k')
            ) {
              event.preventDefault();
              list.selectPrevious();
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              list.selectSelected();
            }
          }}
        />
      </CommandMenuShell.Header>
      <CommandMenuShell.Toolbar class="flex-col items-start gap-2 px-4 py-3">
        <Dialog.Title class="text-sm font-medium text-ink">
          {t('entityActions.movePickerTitle', {
            count: props.entities.length,
          })}
        </Dialog.Title>
        <EntityActionSelection entities={props.entities} />
      </CommandMenuShell.Toolbar>
      <CommandMenuShell.Body class="flex flex-col">
        <CommandMenuList
          id={`${id}-folders`}
          items={items()}
          selectedIndex={list.selectedIndex()}
          scrollSelectedIntoView={list.shouldScrollSelectedIntoView()}
          itemId={(_, index) => `${id}-${index}`}
          itemDisabled={isPending}
          beforeItem={(item, index) => {
            if (item.kind !== 'folder' || query().trim()) return null;
            const previous = items()[index - 1];
            if (previous?.kind === 'folder' && previous.group === item.group)
              return null;
            return (
              <div class="px-2 pt-3 pb-1 text-xs font-medium text-ink-extra-muted first:pt-0">
                {groupLabel(item.group)}
              </div>
            );
          }}
          onItemMouseMove={list.setSelectedIndexFromPointer}
          onSelect={select}
          class="min-h-0 max-h-80 mobile:[&_[role=option]]:h-auto mobile:[&_[role=option]]:min-h-12 mobile:[&_[role=option]]:py-2"
        >
          {(item) => (
            <Show
              when={item.kind === 'folder' ? item : undefined}
              fallback={
                <>
                  <FolderPlusIcon class="size-4 shrink-0 text-ink-muted" />
                  <span class="min-w-0 flex-1 truncate font-medium">
                    {t('entityActions.movePickerCreate', {
                      name: item.name,
                    })}
                  </span>
                </>
              }
            >
              {(folder) => (
                <>
                  <FolderIcon class="size-4 shrink-0 text-ink-muted" />
                  <div class="flex min-w-0 flex-1 items-center gap-2 mobile:flex-col mobile:items-start mobile:gap-0.5">
                    <span class="min-w-0 max-w-full flex-1 truncate font-medium mobile:flex-none">
                      {folder().name}
                    </span>
                    <Show when={folder().path}>
                      <span class="max-w-48 truncate text-xs font-normal text-ink-placeholder mobile:max-w-full">
                        {folder().path}
                      </span>
                    </Show>
                  </div>
                </>
              )}
            </Show>
          )}
        </CommandMenuList>
        <Show when={!items().length}>
          <CommandMenuEmptyState>
            {folderList.isPending()
              ? t('entityActions.movePickerLoading')
              : t('entityActions.movePickerEmpty')}
          </CommandMenuEmptyState>
        </Show>
      </CommandMenuShell.Body>
      <CommandMenuShell.Footer>
        <span role="status">
          <Show
            when={!isPending()}
            fallback={t('entityActions.movePickerMoving')}
          >
            <span class="mobile:hidden">
              {t('entityActions.movePickerKeyboardHint')}
            </span>
            <span class="hidden mobile:inline">
              {t('entityActions.movePickerTouchHint')}
            </span>
          </Show>
        </span>
        <Button
          variant="ghost"
          type="button"
          class="ml-auto shrink-0 text-ink-muted hover:text-ink mobile:min-h-11 mobile:px-2"
          onClick={props.onCancel}
        >
          {t('common.cancel')}
        </Button>
      </CommandMenuShell.Footer>
    </CommandMenuShell>
  );
};
