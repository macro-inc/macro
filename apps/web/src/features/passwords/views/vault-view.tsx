import {
  useViewShell,
  ViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { MobileCreateMenu } from '@components/app/mobile/MobileCreateMenu';
import { type PillTabItem, PillTabs } from '@components/app/mobile/PillTabs';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import FolderPlusIcon from '@icon/system/regular/folder-plus.svg';
import LockIcon from '@icon/system/regular/lock.svg';
import { Button, Dropdown } from '@ui';
import { err } from 'neverthrow';
import {
  createEffect,
  createSignal,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { FavoriteToggle, ItemDetailBody } from '../components/item-detail';
import { ItemForm } from '../components/item-form';
import { ItemList } from '../components/item-list';
import { ItemLogo } from '../components/item-logo';
import { KIND_ICONS } from '../components/kind-icon';
import { NewItemMenu } from '../components/new-item-menu';
import { ShareMenu } from '../components/share-menu';
import {
  FolderActionItems,
  type FolderCommands,
  type FolderEditing,
  VaultSidebar,
  VaultSidebarContent,
} from '../components/vault-sidebar';
import { usePasswords } from '../context/passwords-context';
import { PASSWORD_KINDS } from '../core/kinds';
import {
  folderPath,
  type PasswordFilter,
  type PasswordItem,
  type PasswordKind,
} from '../core/types';
import { createVault, type VaultController } from '../primitives/vault';

type MobileTab = 'all' | 'favorites' | 'recent' | 'shared' | 'folders';

function collectionTitle(vault: VaultController) {
  const filter = vault.filter();
  if (filter.startsWith('folder:'))
    return (
      vault.loadedFolders().find((folder) => folder.id === filter.slice(7))
        ?.name ?? t('passwords.folders')
    );
  return t(`passwords.${filter as 'all' | 'favorites' | 'recent' | 'shared'}`);
}

function destinationFolder(filter: PasswordFilter) {
  return filter.startsWith('folder:') ? filter.slice(7) : null;
}

function EmptyState(props: { vault: VaultController }) {
  const message = () => {
    if (props.vault.search().trim()) return t('passwords.noResults');
    if (props.vault.filter().startsWith('folder:'))
      return t('passwords.emptyFolder');
    if (props.vault.filter() === 'all') return t('passwords.emptyVault');
    return t('passwords.empty');
  };
  return (
    <div class="flex flex-col items-center gap-2 px-4 pt-16 text-center">
      <LockIcon class="size-5 text-ink-extra-muted" />
      <p class="text-sm text-ink-muted">{message()}</p>
    </div>
  );
}

function DetailBack(props: { onBack: () => void }) {
  const shell = useViewShell();
  return (
    <Show when={shell.detail.placement() !== 'inline'}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('passwords.back')}
        tooltip={t('passwords.back')}
        onClick={props.onBack}
      >
        <ArrowLeftIcon class="size-4" />
      </Button>
    </Show>
  );
}

function ItemPane(props: {
  vault: VaultController;
  item: PasswordItem;
  now: number;
  onBack: () => void;
}) {
  const { source, recipients, recipientsLoading, recipientsError } =
    usePasswords();
  const [deletePending, setDeletePending] = createSignal(false);
  createEffect(
    on(
      () => props.item.id,
      () => setDeletePending(false)
    )
  );
  const editEntry = () => props.vault.activeDraft();
  const path = () =>
    [
      ...(props.item.folderId
        ? folderPath(props.vault.loadedFolders(), props.item.folderId)
        : []),
      t(`passwords.${props.item.kind}`),
    ].join(' / ');
  return (
    <div class="flex h-full min-h-0 flex-col">
      <header class="flex h-12 shrink-0 items-center gap-2 border-b border-edge-muted px-3">
        <DetailBack onBack={props.onBack} />
        <ItemLogo
          name={props.item.name}
          kind={props.item.kind}
          url={props.item.url}
          loadLogo={loadLogo(source)}
        />
        <div class="flex min-w-0 flex-1 flex-col">
          <h2 class="truncate text-sm font-semibold text-ink">
            {props.item.name}
          </h2>
          <p class="truncate text-xs text-ink-muted">{path()}</p>
        </div>
        <Show
          when={editEntry()}
          fallback={
            <div
              role="group"
              aria-label={t('passwords.itemActions')}
              class="flex shrink-0 items-center gap-2"
            >
              <FavoriteToggle
                favorite={props.item.favorite}
                onToggle={() =>
                  fireAndForget(
                    props.vault.toggleFavorite(props.item),
                    'passwords'
                  )
                }
              />
              <Show when={props.item.canManage}>
                <ShareMenu
                  recipients={recipients()}
                  recipientsLoading={recipientsLoading()}
                  recipientsError={recipientsError()}
                  onShare={props.vault.share}
                  loadGrants={() =>
                    props.item
                      ? source.grants(props.item.id)
                      : Promise.resolve(err('failed' as const))
                  }
                />
              </Show>
              <Show when={props.item.canEdit}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fireAndForget(props.vault.edit(), 'passwords')}
                >
                  {t('passwords.edit')}
                </Button>
              </Show>
              <Dropdown placement="bottom-end">
                <Dropdown.Trigger
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('passwords.moreActions')}
                >
                  <DotsThreeIcon class="size-4" />
                </Dropdown.Trigger>
                <Dropdown.Content class="min-w-48 max-w-[calc(100vw-2rem)]">
                  <Dropdown.Item onSelect={props.vault.loadActivity}>
                    {t('passwords.activity')}
                  </Dropdown.Item>
                  <Show when={props.item.canManage}>
                    <Dropdown.Item onSelect={() => setDeletePending(true)}>
                      <span class="text-failure-ink">
                        {t('passwords.delete')}
                      </span>
                    </Dropdown.Item>
                  </Show>
                </Dropdown.Content>
              </Dropdown>
            </div>
          }
        >
          {(entry) => (
            <DraftActions vault={props.vault} draftKey={entry().key} />
          )}
        </Show>
      </header>
      <Show when={deletePending() && !editEntry()}>
        <div
          role="alert"
          class="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge-muted px-4 py-2 text-sm"
        >
          <p class="min-w-0 flex-1">{t('passwords.confirmDelete')}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeletePending(false)}
          >
            {t('passwords.cancel')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setDeletePending(false);
              fireAndForget(props.vault.remove(), 'passwords-item-delete');
            }}
          >
            {t('passwords.delete')}
          </Button>
        </div>
      </Show>
      <div
        data-passwords-detail-scroll
        class="min-h-0 flex-1 overflow-auto px-4 pb-4 touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+1rem)]"
      >
        <Show
          when={editEntry()}
          fallback={
            <>
              <Show when={props.vault.failure() === 'failed'}>
                <p role="alert" class="pt-3 text-sm text-failure-ink">
                  {t('passwords.failed')}
                </p>
              </Show>
              <ItemDetailBody
                item={props.item}
                state={{
                  username: props.vault.username(),
                  usernameLoading: props.vault.usernameLoading(),
                  usernameCopied: props.vault.usernameCopied(),
                  values: props.vault.values(),
                  copied: props.vault.copied(),
                  code: props.vault.code(),
                  codeFailed: props.vault.codeFailed(),
                  failure: props.vault.failure(),
                  history: props.vault.history(),
                  activity: props.vault.activity(),
                  now: props.now,
                }}
                actions={{
                  reveal: (version) =>
                    fireAndForget(props.vault.reveal(version), 'passwords'),
                  conceal: props.vault.conceal,
                  copyPassword: () =>
                    fireAndForget(props.vault.copy(), 'passwords'),
                  copyUsername: () =>
                    fireAndForget(props.vault.copyUsername(), 'passwords'),
                  copyValue: props.vault.copyValue,
                  loadCode: () =>
                    fireAndForget(props.vault.loadCode(), 'passwords'),
                  setTotp: props.vault.setTotp,
                  loadHistory: () =>
                    fireAndForget(props.vault.loadHistory(), 'passwords'),
                }}
              />
            </>
          }
        >
          {(entry) => (
            <DraftEditor vault={props.vault} draftKey={entry().key} />
          )}
        </Show>
      </div>
    </div>
  );
}

function DraftActions(props: { vault: VaultController; draftKey: string }) {
  const entry = () => props.vault.draft(props.draftKey);
  return (
    <div class="flex shrink-0 items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={entry()?.busy}
        onClick={() => props.vault.discard(props.draftKey)}
      >
        {t('passwords.discardDraft')}
      </Button>
      <Button
        variant="primary"
        size="sm"
        disabled={entry()?.busy}
        onClick={() =>
          fireAndForget(props.vault.save(props.draftKey), 'passwords')
        }
      >
        {entry()?.failure === 'totp'
          ? t('passwords.retryTotp')
          : t('passwords.save')}
      </Button>
    </div>
  );
}

function DraftEditor(props: { vault: VaultController; draftKey: string }) {
  const entry = () => props.vault.draft(props.draftKey);
  const hasTotp = () => {
    const itemId = entry()?.itemId;
    return (
      !!itemId &&
      !!props.vault.loadedItems().find((item) => item.id === itemId)?.hasTotp
    );
  };
  return (
    <Show when={entry()}>
      {(current) => (
        <div class="flex flex-col gap-4 pt-4">
          <Switch>
            <Match when={current().failure === 'totp'}>
              <p role="alert" class="text-sm text-failure-ink">
                {t('passwords.totpFailed')}
              </p>
            </Match>
            <Match when={current().failure === 'folderMissing'}>
              <p role="alert" class="text-sm text-failure-ink">
                {t('passwords.folderMissing')}
              </p>
            </Match>
            <Match when={current().failure}>
              <p role="alert" class="text-sm text-failure-ink">
                {t('passwords.failed')}
              </p>
            </Match>
          </Switch>
          <ItemForm
            idPrefix={`passwords-${props.draftKey}`}
            draft={current().draft}
            totpKey={current().totpKey}
            hasTotp={hasTotp()}
            validation={current().validation}
            folders={props.vault.loadedFolders()}
            isNew={!current().itemId}
            onChange={(draft) => props.vault.updateDraft(props.draftKey, draft)}
            onTotpKey={(value) =>
              props.vault.setDraftTotpKey(props.draftKey, value)
            }
          />
        </div>
      )}
    </Show>
  );
}

function NewDraftPane(props: {
  vault: VaultController;
  draftKey: string;
  onBack: () => void;
}) {
  const entry = () => props.vault.draft(props.draftKey);
  return (
    <Show when={entry()}>
      {(current) => (
        <div class="flex h-full min-h-0 flex-col">
          <header class="flex h-12 shrink-0 items-center gap-2 border-b border-edge-muted px-3">
            <DetailBack onBack={props.onBack} />
            <span class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-edge-muted text-ink-muted">
              <Dynamic
                component={KIND_ICONS[current().draft.kind]}
                class="size-4"
              />
            </span>
            <div class="flex min-w-0 flex-1 flex-col">
              <h2 class="truncate text-sm font-semibold text-ink">
                {current().draft.name.trim() || t('passwords.untitled')}
              </h2>
              <p class="truncate text-xs text-ink-muted">
                {t(`passwords.${current().draft.kind}`)}
              </p>
            </div>
            <DraftActions vault={props.vault} draftKey={props.draftKey} />
          </header>
          <div class="min-h-0 flex-1 overflow-auto px-4 pb-4 touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+1rem)]">
            <DraftEditor vault={props.vault} draftKey={props.draftKey} />
          </div>
        </div>
      )}
    </Show>
  );
}

function loadLogo(source: ReturnType<typeof usePasswords>['source']) {
  return async (domain: string) => {
    const result = await source.logo(domain);
    return result.isOk() ? result.value : undefined;
  };
}

/**
 * The floating New on touch layouts. Phones hide it while a detail replaces
 * the list; tablets keep the detail beside the list, so it stays.
 */
function MobileNew(props: {
  hasSelection: boolean;
  onCreate: (kind: PasswordKind) => void;
  onFolder: () => void;
}) {
  const shell = useViewShell();
  return (
    <FloatRegion
      region="accessory"
      active={() =>
        !props.hasSelection || shell.detail.placement() === 'inline'
      }
    >
      <div class="pointer-events-auto flex justify-end px-(--mobile-chrome-gutter)">
        <MobileCreateMenu
          label={t('passwords.new')}
          items={[
            ...PASSWORD_KINDS.map((kind) => ({
              label: t(`passwords.${kind}`),
              icon: KIND_ICONS[kind],
              onSelect: () => props.onCreate(kind),
            })),
            {
              label: t('passwords.folder'),
              icon: FolderPlusIcon,
              onSelect: props.onFolder,
            },
          ]}
        />
      </div>
    </FloatRegion>
  );
}

function LeavePrompt(props: {
  count: number;
  onDiscard: () => void;
  onStay: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label={t('passwords.leaveTitle')}
      class="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge-muted bg-panel px-4 py-2 text-sm"
    >
      <p class="min-w-0 flex-1">
        <span class="font-medium">{t('passwords.leaveTitle')}</span>{' '}
        <span class="text-ink-muted">
          {t('passwords.leaveBody', { count: props.count })}
        </span>
      </p>
      <Button variant="ghost" size="sm" onClick={props.onStay}>
        {t('passwords.keepEditing')}
      </Button>
      <Button variant="danger" size="sm" onClick={props.onDiscard}>
        {t('passwords.discardAll')}
      </Button>
    </div>
  );
}

export function VaultView(props: {
  onGuard?: (guard: () => Promise<boolean>) => void;
}) {
  const vault = createVault();
  const { source } = usePasswords();
  const logo = loadLogo(source);
  const [editingFolder, setEditingFolder] = createSignal<FolderEditing>();
  const [expandedIds, setExpandedIds] = createSignal<string[]>([]);
  const expand = (id: string) =>
    setExpandedIds((current) =>
      current.includes(id) ? current : [...current, id]
    );
  /** A new subfolder opens its parent's branch so the name field shows. */
  const setEditing = (next: FolderEditing | undefined) => {
    if (next?.kind === 'create' && next.parentId) expand(next.parentId);
    setEditingFolder(next);
  };
  const editing = editingFolder;
  /** A name field chosen in the header menu, opened when the menu closes. */
  let headerEditor: FolderEditing | undefined;
  const [mobileFolders, setMobileFolders] = createSignal(false);
  const [leave, setLeave] = createSignal<(allow: boolean) => void>();
  const [now, setNow] = createSignal(Date.now());
  const ticker = setInterval(() => {
    setNow(Date.now());
    const code = vault.code();
    if (code && Date.parse(code.validUntil) <= Date.now())
      fireAndForget(vault.loadCode(), 'passwords');
  }, 1000);
  onCleanup(() => {
    clearInterval(ticker);
    leave()?.(false);
  });
  props.onGuard?.(() => {
    if (!vault.dirty()) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      leave()?.(false);
      setLeave(() => (allow: boolean) => {
        setLeave(undefined);
        if (allow) vault.discardAll();
        resolve(allow);
      });
    });
  });
  usePending('passwords.items', () => vault.items.isLoading);
  usePending('passwords.folders', () => vault.folders.isLoading);

  const destination = () => {
    const id = destinationFolder(vault.filter());
    return id
      ? folderPath(vault.loadedFolders(), id).join(' / ')
      : t('passwords.passwordsRoot');
  };
  const create = (kind: PasswordKind) =>
    vault.createItem(kind, destinationFolder(vault.filter()));
  const startFolder = () => {
    setMobileFolders(true);
    setEditing({
      kind: 'create',
      parentId: destinationFolder(vault.filter()),
    });
  };
  const commands: FolderCommands = {
    create: (name, parentId) => vault.createFolder(name, parentId),
    rename: vault.renameFolder,
    remove: vault.deleteFolder,
    move: vault.moveFolder,
    moveItem: async (itemId, folderId) => {
      const item = vault.loadedItems().find((entry) => entry.id === itemId);
      if (item && item.folderId !== folderId) await vault.move(item, folderId);
    },
  };
  const selectFilter = (filter: PasswordFilter) => {
    vault.setFilter(filter);
    setMobileFolders(false);
  };
  const currentFolder = () => {
    const id = destinationFolder(vault.filter());
    return id
      ? vault.loadedFolders().find((folder) => folder.id === id)
      : undefined;
  };
  const selection = () => vault.selection();
  const selectedItemId = () => {
    const current = selection();
    return current?.kind === 'item' ? current.id : undefined;
  };
  const selectedDraftKey = () => {
    const current = selection();
    return current?.kind === 'draft' ? current.key : undefined;
  };
  const mobileTab = (): MobileTab => {
    if (mobileFolders() || vault.filter().startsWith('folder:'))
      return 'folders';
    return vault.filter() as MobileTab;
  };
  const mobileTabs = (): PillTabItem<MobileTab>[] =>
    (['all', 'favorites', 'recent', 'shared', 'folders'] as const).map(
      (value) => ({
        value,
        label: t(
          value === 'folders' ? 'passwords.folders' : `passwords.${value}`
        ),
      })
    );
  const sidebarProps = () => ({
    folders: vault.loadedFolders(),
    items: vault.loadedItems(),
    filter: vault.filter(),
    editing: editing(),
    onEditing: setEditing,
    expandedIds: expandedIds(),
    onToggle: (id: string) =>
      setExpandedIds((current) =>
        current.includes(id)
          ? current.filter((entry) => entry !== id)
          : [...current, id]
      ),
    onFilter: selectFilter,
    commands,
  });

  return (
    <div class="flex h-full min-h-0 flex-col" data-passwords-vault>
      <Show when={leave()}>
        {(resolve) => (
          <LeavePrompt
            count={Object.keys(vault.drafts()).length}
            onDiscard={() => resolve()(true)}
            onStay={() => resolve()(false)}
          />
        )}
      </Show>
      <ViewShell.Root
        class="min-h-0 flex-1"
        asidePreferenceKey="passwords"
        resizable
        aside={{ preserveDuringResize: false }}
        main={{ preferredWidth: 480 }}
        detail={{
          width: 520,
          initialWidth: 'auto',
          min: 380,
          max: 900,
          whenNarrow: 'replace',
        }}
        detailOpen={!!selection()}
      >
        <ViewShell.Aside>
          <VaultSidebar
            {...sidebarProps()}
            search={vault.search()}
            onSearch={vault.setSearch}
            destination={destination()}
            onCreate={create}
            onLock={vault.lock}
          />
        </ViewShell.Aside>
        <ViewShell.Main>
          <Show
            when={isTouchDevice()}
            fallback={
              <ListHeader
                title={
                  <ViewSidebar.Title caret={false}>
                    {collectionTitle(vault)}
                  </ViewSidebar.Title>
                }
              >
                <Show when={currentFolder()}>
                  {(folder) => (
                    <Dropdown placement="bottom-end">
                      <Dropdown.Trigger
                        variant="secondary"
                        size="icon-md"
                        aria-label={t('passwords.folderActions', {
                          name: folder().name,
                        })}
                        tooltip={t('passwords.folderActions', {
                          name: folder().name,
                        })}
                      >
                        <DotsThreeIcon class="size-4" />
                      </Dropdown.Trigger>
                      <Dropdown.Content
                        class="min-w-48 max-w-[calc(100vw-2rem)]"
                        onCloseAutoFocus={(event) => {
                          // A name field opens only once the menu's focus trap
                          // has gone, so it keeps the focus it takes on mount.
                          const editor = headerEditor;
                          headerEditor = undefined;
                          if (!editor) return;
                          event.preventDefault();
                          setEditing(editor);
                        }}
                      >
                        <FolderActionItems
                          onSubfolder={() => {
                            headerEditor = {
                              kind: 'create',
                              parentId: folder().id,
                            };
                          }}
                          onRename={() => {
                            headerEditor = { kind: 'rename', id: folder().id };
                          }}
                          onMove={() =>
                            setEditing({ kind: 'move', id: folder().id })
                          }
                          onDelete={() =>
                            setEditing({ kind: 'delete', id: folder().id })
                          }
                          item={(item) => (
                            <Dropdown.Item onSelect={item.onSelect}>
                              <span
                                class={
                                  item.danger ? 'text-failure-ink' : undefined
                                }
                              >
                                {item.text}
                              </span>
                            </Dropdown.Item>
                          )}
                        />
                      </Dropdown.Content>
                    </Dropdown>
                  )}
                </Show>
                <NewItemMenu
                  presentation="toolbar"
                  destination={destination()}
                  onCreate={create}
                  onFolder={startFolder}
                />
                <ListHeaderSearch
                  label={t('passwords.search')}
                  placeholder={t('passwords.search')}
                  value={vault.search()}
                  onValueChange={vault.setSearch}
                  registerFocus={() => {}}
                />
              </ListHeader>
            }
          >
            <ViewShell.TopBar>
              <ViewSidebar.Title caret={false}>
                {mobileFolders()
                  ? t('passwords.folders')
                  : collectionTitle(vault)}
              </ViewSidebar.Title>
            </ViewShell.TopBar>
            <ViewShell.Header>
              <div class="flex min-w-0 flex-col gap-1">
                <div class="h-10 min-w-0 flex-1">
                  <PillTabs
                    scrollable
                    class="-ml-(--mobile-chrome-gutter) w-[calc(100%+2*var(--mobile-chrome-gutter))] max-w-none flex-none"
                    contentClass="px-(--mobile-chrome-gutter)"
                    items={mobileTabs()}
                    value={mobileTab()}
                    onChange={(tab) =>
                      tab === 'folders'
                        ? setMobileFolders(true)
                        : selectFilter(tab)
                    }
                  />
                </div>
              </div>
            </ViewShell.Header>
            <MobileNew
              hasSelection={!!selection()}
              onCreate={create}
              onFolder={startFolder}
            />
          </Show>
          <ViewShell.Content>
            <div class="h-full overflow-auto touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+6rem)]">
              <Switch>
                <Match when={isTouchDevice() && mobileFolders()}>
                  <div class="flex flex-col gap-(--sidebar-section-gap) px-(--sidebar-gutter) py-2">
                    <VaultSidebarContent {...sidebarProps()} />
                  </div>
                </Match>
                <Match when={vault.items.isPending}>
                  <p class="p-4 text-sm text-ink-muted">
                    {t('passwords.loading')}
                  </p>
                </Match>
                <Match when={vault.items.isError && !vault.items.data}>
                  <div class="flex flex-col items-start gap-2 p-4">
                    <p role="alert" class="text-sm">
                      {t('passwords.failed')}
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => vault.items.refetch()}
                    >
                      {t('passwords.retry')}
                    </Button>
                  </div>
                </Match>
                <Match when={true}>
                  <ItemList
                    items={vault.visibleItems()}
                    drafts={vault.drafts()}
                    selectedItemId={selectedItemId()}
                    selectedDraftKey={selectedDraftKey()}
                    onSelect={vault.select}
                    onSelectDraft={vault.selectDraft}
                    loadLogo={logo}
                  />
                  <Show
                    when={
                      vault.visibleItems().length === 0 &&
                      vault.drafts().length === 0
                    }
                  >
                    <EmptyState vault={vault} />
                  </Show>
                </Match>
              </Switch>
            </div>
          </ViewShell.Content>
        </ViewShell.Main>
        <ViewShell.Detail class="border-l border-edge-muted">
          {/* Keyed: a pane gets its own value, never a getter over the Match
              accessor, which throws a stale read once the selection moves on. */}
          <Switch>
            <Match when={selectedDraftKey()} keyed>
              {(key) => (
                <NewDraftPane
                  vault={vault}
                  draftKey={key}
                  onBack={() => vault.select(undefined)}
                />
              )}
            </Match>
            <Match when={vault.selected()} keyed>
              {(item) => (
                <ItemPane
                  vault={vault}
                  item={item}
                  now={now()}
                  onBack={() => vault.select(undefined)}
                />
              )}
            </Match>
          </Switch>
        </ViewShell.Detail>
      </ViewShell.Root>
    </div>
  );
}
