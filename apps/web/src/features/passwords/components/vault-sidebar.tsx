import { t } from '@app/lib/i18n';
import ClockIcon from '@icon/system/regular/clock.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import LockIcon from '@icon/system/regular/lock.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import StarIcon from '@icon/system/regular/star.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { Button, Input } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  filterItems,
  type PasswordFilter,
  type PasswordFolder,
  type PasswordItem,
} from '../core/types';

const FILTER_ICONS = {
  all: FolderIcon,
  favorites: StarIcon,
  recent: ClockIcon,
  shared: UsersIcon,
};

export function VaultSidebar(props: {
  folders: PasswordFolder[];
  items: PasswordItem[];
  filter: PasswordFilter;
  onFilter: (filter: PasswordFilter) => void;
  onCreate: () => void;
  onFolder: (name: string) => Promise<boolean | undefined>;
  onMove: (itemId: string, folderId: string) => Promise<void>;
  onLock: () => void;
}) {
  const [creatingFolder, setCreatingFolder] = createSignal(false);
  const [name, setName] = createSignal('');
  async function createFolder(event: SubmitEvent) {
    event.preventDefault();
    if (!(await props.onFolder(name()))) return;
    setName('');
    setCreatingFolder(false);
  }
  return (
    <nav
      aria-label={t('passwords.navigation')}
      class="flex h-full flex-col gap-2 p-3"
    >
      <h1 class="px-2 py-1 font-semibold">{t('passwords.title')}</h1>
      <Button variant="secondary" onClick={props.onCreate}>
        <PlusIcon class="size-4" />
        {t('passwords.newItem')}
      </Button>
      <For each={['all', 'favorites', 'recent', 'shared'] as const}>
        {(filter) => (
          <Button
            variant="ghost"
            aria-pressed={props.filter === filter}
            class="justify-start"
            onClick={() => props.onFilter(filter)}
          >
            <Dynamic component={FILTER_ICONS[filter]} class="size-4 shrink-0" />
            <span class="flex-1 text-left">{t(`passwords.${filter}`)}</span>
            <span class="text-xs text-ink-muted">
              {filterItems(props.items, filter, '').length}
            </span>
          </Button>
        )}
      </For>
      <div class="mt-4 flex items-center justify-between px-2 text-xs text-ink-muted">
        <span>{t('passwords.folders')}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('passwords.newFolder')}
          tooltip={t('passwords.newFolder')}
          onClick={() => setCreatingFolder(!creatingFolder())}
        >
          <PlusIcon class="size-4" />
        </Button>
      </div>
      <Show when={creatingFolder()}>
        <form class="flex flex-col gap-2" onSubmit={createFolder}>
          <Input
            aria-label={t('passwords.folderName')}
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
            required
          />
          <Button type="submit" variant="secondary">
            {t('passwords.save')}
          </Button>
        </form>
      </Show>
      <For each={props.folders}>
        {(folder) => (
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={async (event) => {
              event.preventDefault();
              const id = event.dataTransfer?.getData(
                'application/x-macro-password'
              );
              if (id) await props.onMove(id, folder.id);
            }}
          >
            <Button
              variant="ghost"
              class="w-full justify-start"
              aria-pressed={props.filter === `folder:${folder.id}`}
              onClick={() => props.onFilter(`folder:${folder.id}`)}
            >
              <FolderIcon class="size-4 shrink-0" />
              <span class="min-w-0 flex-1 truncate text-left">
                {folder.name}
              </span>
              <span class="text-xs text-ink-muted">
                {
                  props.items.filter((item) => item.folderId === folder.id)
                    .length
                }
              </span>
            </Button>
          </div>
        )}
      </For>
      <div class="mt-auto border-t border-edge-muted pt-2">
        <Button
          variant="ghost"
          class="w-full justify-start"
          onClick={props.onLock}
        >
          <LockIcon class="size-4" />
          {t('passwords.lock')}
        </Button>
      </div>
    </nav>
  );
}
