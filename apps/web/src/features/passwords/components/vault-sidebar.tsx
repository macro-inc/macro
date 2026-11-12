import {
  CollapsibleSection,
  SearchBar,
  ViewSidebar,
} from '@app/components/view-shell';
import { FolderTree } from '@app/features/drive-view/components/folder-tree';
import { buildFolderTree } from '@app/features/drive-view/core/folder-tree';
import type { DriveLocation } from '@app/features/drive-view/core/types';
import { t } from '@app/lib/i18n';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { fireAndForget } from '@core/util/fireAndForget';
import ClockIcon from '@icon/system/regular/clock.svg';
import FilesIcon from '@icon/system/regular/files.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import LockIcon from '@icon/system/regular/lock.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import StarIcon from '@icon/system/regular/star.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import { Button, cn, Input } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  type ParentProps,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  folderPath,
  folderSubtree,
  type PasswordFilter,
  type PasswordFolder,
  type PasswordItem,
  type PasswordKind,
} from '../core/types';
import { NewItemMenu } from './new-item-menu';

const COLLECTIONS = [
  { id: 'all', icon: FilesIcon },
  { id: 'favorites', icon: StarIcon },
  { id: 'recent', icon: ClockIcon },
  { id: 'shared', icon: UsersIcon },
] as const;

export const PASSWORD_ITEM_DRAG_TYPE = 'application/x-macro-password';

export type FolderEditing =
  | { kind: 'rename'; id: string }
  | { kind: 'delete'; id: string }
  | { kind: 'move'; id: string }
  | { kind: 'create'; parentId: string | null };

export type FolderCommands = {
  create: (name: string, parentId: string | null) => Promise<unknown>;
  rename: (id: string, name: string) => Promise<boolean | undefined>;
  remove: (id: string) => Promise<boolean | undefined>;
  move: (id: string, parentId: string | null) => Promise<boolean | undefined>;
  moveItem: (itemId: string, folderId: string | null) => Promise<void>;
};

/** Dropping a password row onto a folder (or the root) files it there. */
function DropTarget(
  props: ParentProps<{
    onDrop: (itemId: string) => void;
  }>
) {
  const [over, setOver] = createSignal(false);
  return (
    <div
      class={cn(
        'rounded-lg',
        over() && 'outline-2 -outline-offset-2 outline-accent'
      )}
      onDragOver={(event) => {
        if (!event.dataTransfer?.types.includes(PASSWORD_ITEM_DRAG_TYPE))
          return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        const id = event.dataTransfer?.getData(PASSWORD_ITEM_DRAG_TYPE);
        if (!id) return;
        event.preventDefault();
        props.onDrop(id);
      }}
    >
      {props.children}
    </div>
  );
}

/** Inline name field used for new folders and renames. */
export function FolderNameField(props: {
  value: string;
  label: string;
  onCommit: (name: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [name, setName] = createSignal(props.value);
  const [busy, setBusy] = createSignal(false);
  // Escape or a finished commit ends the field; the blur that follows must not
  // commit again.
  let settled = false;
  const cancel = () => {
    settled = true;
    props.onCancel();
  };
  async function commit() {
    if (settled || busy()) return;
    if (!name().trim()) {
      cancel();
      return;
    }
    setBusy(true);
    try {
      await props.onCommit(name());
      settled = true;
    } finally {
      setBusy(false);
    }
  }
  const start = () => fireAndForget(commit(), 'passwords-folder-name');
  return (
    <form
      class="flex min-w-0 items-center gap-(--sidebar-label-gap) px-(--sidebar-item-inset)"
      onSubmit={(event) => {
        event.preventDefault();
        start();
      }}
    >
      <FolderIcon class="size-4 shrink-0 text-ink-muted" />
      <Input
        size="sm"
        class="min-w-0 flex-1"
        aria-label={props.label}
        value={name()}
        disabled={busy()}
        ref={(element) => queueMicrotask(() => element.select())}
        onInput={(event) => setName(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          }
        }}
        onBlur={start}
      />
    </form>
  );
}

/** Confirms a folder delete in place, saying where its items go. */
export function FolderDeleteConfirm(props: {
  folder: PasswordFolder;
  items: number;
  subfolders: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label={t('passwords.deleteFolderTitle', { name: props.folder.name })}
      class="menu-surface flex flex-col gap-2 rounded-lg p-3 text-sm"
    >
      <p class="font-medium">
        {t('passwords.deleteFolderTitle', { name: props.folder.name })}
      </p>
      <p class="text-ink-muted">
        {props.items > 0
          ? t('passwords.deleteFolderItems', { count: props.items })
          : t('passwords.deleteFolderEmpty')}
        <Show when={props.subfolders > 0}>
          {' '}
          {t('passwords.deleteFolderSubfolders', { count: props.subfolders })}
        </Show>
      </p>
      <div class="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={props.onCancel}>
          {t('passwords.cancel')}
        </Button>
        <Button variant="danger" size="sm" onClick={props.onConfirm}>
          {t('passwords.deleteFolder')}
        </Button>
      </div>
    </div>
  );
}

/** Destinations for moving a folder: never itself or one of its subfolders. */
export function folderDestinations(
  folders: PasswordFolder[],
  folder: PasswordFolder
) {
  const blocked = folderSubtree(folders, folder.id);
  return folders.filter(
    (candidate) =>
      !blocked.has(candidate.id) && candidate.id !== folder.parentId
  );
}

/** Picks where a folder moves, in place of its row. */
export function FolderMovePicker(props: {
  folder: PasswordFolder;
  folders: PasswordFolder[];
  onMove: (parentId: string | null) => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="group"
      aria-label={t('passwords.moveFolderTo', { name: props.folder.name })}
      class="menu-surface flex flex-col gap-0.5 rounded-lg p-1.5 text-sm"
    >
      <p class="px-2 py-1 text-xs text-ink-extra-muted">
        {t('passwords.moveFolderTo', { name: props.folder.name })}
      </p>
      <Show when={props.folder.parentId}>
        <Button
          variant="ghost"
          size="sm"
          class="justify-start"
          onClick={() => props.onMove(null)}
        >
          <FolderIcon class="size-4 shrink-0" />
          <span class="truncate">{t('passwords.topLevel')}</span>
        </Button>
      </Show>
      <For each={folderDestinations(props.folders, props.folder)}>
        {(destination) => (
          <Button
            variant="ghost"
            size="sm"
            class="justify-start"
            onClick={() => props.onMove(destination.id)}
          >
            <FolderIcon class="size-4 shrink-0" />
            <span class="truncate">
              {folderPath(props.folders, destination.id).join(' / ')}
            </span>
          </Button>
        )}
      </For>
      <Button
        variant="ghost"
        size="sm"
        class="self-end"
        onClick={props.onCancel}
      >
        {t('passwords.cancel')}
      </Button>
    </div>
  );
}

/** Shared folder actions for the row context menu and the header menu. */
export function FolderActionItems(props: {
  onSubfolder: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  item: (props: {
    text: string;
    danger?: boolean;
    onSelect: () => void;
  }) => JSX.Element;
}) {
  return (
    <>
      {props.item({
        text: t('passwords.newSubfolder'),
        onSelect: props.onSubfolder,
      })}
      {props.item({
        text: t('passwords.renameFolder'),
        onSelect: props.onRename,
      })}
      {props.item({ text: t('passwords.moveFolder'), onSelect: props.onMove })}
      {props.item({
        text: t('passwords.deleteFolder'),
        danger: true,
        onSelect: props.onDelete,
      })}
    </>
  );
}

/** The rename field, move picker, or delete confirmation shown in a folder's row. */
export function FolderRowEditor(props: {
  editing: FolderEditing | undefined;
  folder: PasswordFolder | undefined;
  folders: PasswordFolder[];
  items: number;
  commands: FolderCommands;
  onDone: () => void;
}) {
  return (
    <Show when={props.folder}>
      {(folder) => (
        <Switch>
          <Match when={props.editing?.kind === 'rename'}>
            <FolderNameField
              value={folder().name}
              label={t('passwords.renameFolder')}
              onCommit={async (name) => {
                if (name.trim() !== folder().name)
                  await props.commands.rename(folder().id, name);
                props.onDone();
              }}
              onCancel={props.onDone}
            />
          </Match>
          <Match when={props.editing?.kind === 'move'}>
            <FolderMovePicker
              folder={folder()}
              folders={props.folders}
              onCancel={props.onDone}
              onMove={(parentId) => {
                props.onDone();
                fireAndForget(
                  props.commands.move(folder().id, parentId),
                  'passwords-folder-move'
                );
              }}
            />
          </Match>
          <Match when={props.editing?.kind === 'delete'}>
            <FolderDeleteConfirm
              folder={folder()}
              items={props.items}
              subfolders={folderSubtree(props.folders, folder().id).size - 1}
              onCancel={props.onDone}
              onConfirm={() => {
                props.onDone();
                fireAndForget(
                  props.commands.remove(folder().id),
                  'passwords-folder-delete'
                );
              }}
            />
          </Match>
        </Switch>
      )}
    </Show>
  );
}

export function VaultSidebarContent(props: {
  folders: PasswordFolder[];
  items: PasswordItem[];
  filter: PasswordFilter;
  editing: FolderEditing | undefined;
  onEditing: (editing: FolderEditing | undefined) => void;
  expandedIds: string[];
  onToggle: (id: string) => void;
  onFilter: (filter: PasswordFilter) => void;
  commands: FolderCommands;
  onLock?: () => void;
}) {
  const [open, setOpen] = createSignal(true);
  const tree = createMemo(() => buildFolderTree(props.folders));
  const selectedFolder = () =>
    props.filter.startsWith('folder:') ? props.filter.slice(7) : undefined;
  const folderById = (id: string) =>
    props.folders.find((folder) => folder.id === id);
  // The view opens the parent's branch when it starts a subfolder.
  const startSubfolder = (parentId: string | null) => {
    setOpen(true);
    props.onEditing({ kind: 'create', parentId });
  };
  const itemsIn = (id: string) => {
    const scope = folderSubtree(props.folders, id);
    return props.items.filter(
      (item) => item.folderId && scope.has(item.folderId)
    ).length;
  };

  function FolderRowShell(rowProps: ParentProps<{ location: DriveLocation }>) {
    const folder = () =>
      rowProps.location.kind === 'folder' && rowProps.location.id
        ? folderById(rowProps.location.id)
        : undefined;
    return (
      <Show when={folder()} fallback={rowProps.children}>
        {(current) => (
          <ContextMenu>
            <ContextMenu.Trigger class="block w-full">
              <DropTarget
                onDrop={(itemId) =>
                  fireAndForget(
                    props.commands.moveItem(itemId, current().id),
                    'passwords-item-move'
                  )
                }
              >
                {rowProps.children}
              </DropTarget>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenuContent>
                <FolderActionItems
                  onSubfolder={() => startSubfolder(current().id)}
                  onRename={() =>
                    props.onEditing({ kind: 'rename', id: current().id })
                  }
                  onMove={() =>
                    props.onEditing({ kind: 'move', id: current().id })
                  }
                  onDelete={() =>
                    props.onEditing({ kind: 'delete', id: current().id })
                  }
                  item={(item) => (
                    <MenuItem
                      text={item.text}
                      class={item.danger ? 'text-failure-ink' : undefined}
                      onClick={item.onSelect}
                    />
                  )}
                />
              </ContextMenuContent>
            </ContextMenu.Portal>
          </ContextMenu>
        )}
      </Show>
    );
  }

  const replacedRow = () =>
    props.editing && props.editing.kind !== 'create'
      ? props.editing.id
      : undefined;

  return (
    <>
      <ViewSidebar.Nav aria-label={t('passwords.navigation')}>
        <For each={COLLECTIONS}>
          {(collection) => (
            <ViewSidebar.Item
              active={props.filter === collection.id}
              onClick={() => props.onFilter(collection.id)}
            >
              <ViewSidebar.Icon>
                <Dynamic component={collection.icon} class="size-4" />
              </ViewSidebar.Icon>
              <span class="truncate">{t(`passwords.${collection.id}`)}</span>
            </ViewSidebar.Item>
          )}
        </For>
      </ViewSidebar.Nav>
      <CollapsibleSection.Root open={open()} onOpenChange={setOpen}>
        <CollapsibleSection.Header>
          <CollapsibleSection.Trigger class="flex-1">
            <span class="min-w-0 truncate">{t('passwords.folders')}</span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
          <CollapsibleSection.Action
            aria-label={t('passwords.newFolder')}
            onClick={() => startSubfolder(null)}
          >
            <PlusIcon class="size-3.5" />
          </CollapsibleSection.Action>
        </CollapsibleSection.Header>
        <CollapsibleSection.Content>
          <ViewSidebar.Nav aria-label={t('passwords.folders')}>
            <DropTarget
              onDrop={(itemId) =>
                fireAndForget(
                  props.commands.moveItem(itemId, null),
                  'passwords-item-move'
                )
              }
            >
              <ViewSidebar.Item
                active={props.filter === 'all'}
                onClick={() => props.onFilter('all')}
              >
                <ViewSidebar.Icon>
                  <FolderIcon class="size-4" />
                </ViewSidebar.Icon>
                <span class="truncate">{t('passwords.passwordsRoot')}</span>
              </ViewSidebar.Item>
            </DropTarget>
            <ViewSidebar.Branch>
              <Show when={props.editing?.kind === 'create' && props.editing}>
                {(editing) => (
                  <FolderNameField
                    value=""
                    label={t('passwords.folderName')}
                    onCommit={async (name) => {
                      const current = editing();
                      await props.commands.create(
                        name,
                        current.kind === 'create' ? current.parentId : null
                      );
                      props.onEditing(undefined);
                    }}
                    onCancel={() => props.onEditing(undefined)}
                  />
                )}
              </Show>
              <FolderTree
                nodes={tree()}
                selectedId={selectedFolder()}
                expandedIds={props.expandedIds}
                searching={false}
                onToggle={props.onToggle}
                onSelect={(id) => props.onFilter(`folder:${id}`)}
                locationMenu={FolderRowShell}
                renamingId={replacedRow()}
                renderRename={(node) => (
                  <FolderRowEditor
                    editing={props.editing}
                    folder={folderById(node.id)}
                    folders={props.folders}
                    items={itemsIn(node.id)}
                    commands={props.commands}
                    onDone={() => props.onEditing(undefined)}
                  />
                )}
              />
            </ViewSidebar.Branch>
          </ViewSidebar.Nav>
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>
      <Show when={props.onLock}>
        {(lock) => (
          <ViewSidebar.Nav aria-label={t('passwords.lock')} class="mt-auto">
            <ViewSidebar.Item onClick={() => lock()()}>
              <ViewSidebar.Icon>
                <LockIcon class="size-4" />
              </ViewSidebar.Icon>
              <span class="truncate">{t('passwords.lock')}</span>
            </ViewSidebar.Item>
          </ViewSidebar.Nav>
        )}
      </Show>
    </>
  );
}

export function VaultSidebar(
  props: Parameters<typeof VaultSidebarContent>[0] & {
    search: string;
    onSearch: (value: string) => void;
    destination: string;
    onCreate: (kind: PasswordKind) => void;
  }
) {
  return (
    <ViewSidebar.Root aria-label={t('passwords.navigation')}>
      <ViewSidebar.Header
        searchLabel={t('passwords.search')}
        search={() => (
          <SearchBar
            label={t('passwords.search')}
            placeholder={t('passwords.search')}
            value={props.search}
            onValueChange={props.onSearch}
          />
        )}
      >
        <div class="flex min-w-0 items-center gap-1">
          <ViewSidebar.CloseButton />
          <ViewSidebar.Title>{t('passwords.title')}</ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>
      <ViewSidebar.Primary>
        <NewItemMenu
          presentation="sidebar"
          destination={props.destination}
          onCreate={props.onCreate}
          onFolder={() =>
            props.onEditing({
              kind: 'create',
              parentId: props.filter.startsWith('folder:')
                ? props.filter.slice(7)
                : null,
            })
          }
        />
      </ViewSidebar.Primary>
      <ViewSidebar.Content>
        <VaultSidebarContent {...props} />
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
