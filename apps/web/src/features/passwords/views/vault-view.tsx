import { formatLocale, t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { fireAndForget } from '@core/util/fireAndForget';
import CheckIcon from '@icon/system/regular/check.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import EyeIcon from '@icon/system/regular/eye.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { Button, Dropdown, Input } from '@ui';
import { err } from 'neverthrow';
import {
  createEffect,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { CredentialEditor } from '../components/credential-editor';
import { ShareMenu } from '../components/share-menu';
import { VaultSidebar } from '../components/vault-sidebar';
import { usePasswords } from '../context/passwords-context';
import type { PasswordItem } from '../core/types';
import { createVault } from '../primitives/vault';

export function VaultView(props: {
  teamId: string;
  onGuard?: (dirty: () => boolean) => void;
}) {
  const vault = createVault(props.teamId);
  const { source, recipients, recipientsLoading, recipientsError } =
    usePasswords();
  const [showNavigation, setShowNavigation] = createSignal(false);
  const [deletePending, setDeletePending] = createSignal(false);
  createEffect(
    on(
      () => vault.selected()?.id,
      () => setDeletePending(false)
    )
  );
  const totpKey = vault.totpKey;
  const setTotpKey = vault.setTotpKey;
  const [now, setNow] = createSignal(Date.now());
  const ticker = setInterval(() => {
    setNow(Date.now());
    const code = vault.code();
    if (code && Date.parse(code.validUntil) <= Date.now())
      fireAndForget(vault.loadCode(), 'passwords');
  }, 1000);
  onCleanup(() => clearInterval(ticker));
  props.onGuard?.(() => {
    if (!vault.draft()) return false;
    vault.setPendingSelection({ item: vault.selected() });
    return true;
  });
  usePending('passwords.items', () => vault.items.isLoading);
  usePending('passwords.folders', () => vault.folders.isLoading);
  const folders = () =>
    vault.folders.isPending ? [] : (vault.folders.data ?? []);
  const collectionName = () => {
    const filter = vault.filter();
    if (filter.startsWith('folder:'))
      return (
        folders().find((folder) => folder.id === filter.slice(7))?.name ??
        t('passwords.folders')
      );
    return t(
      `passwords.${filter as 'all' | 'favorites' | 'recent' | 'shared'}`
    );
  };
  const detailOpen = () => !!vault.selected() || !!vault.draft();
  async function move(id: string, folderId: string) {
    const item = vault.visibleItems().find((item) => item.id === id);
    if (item && !vault.draft()) await vault.move(item, folderId);
  }
  return (
    <div
      class="flex h-full min-h-0 overflow-hidden bg-panel text-ink"
      data-passwords-vault
    >
      <aside class="w-56 shrink-0 border-r border-edge-muted max-lg:hidden">
        <VaultSidebar
          items={vault.items.isPending ? [] : (vault.items.data ?? [])}
          folders={folders()}
          filter={vault.filter()}
          onFilter={vault.setFilter}
          onCreate={vault.createItem}
          onFolder={vault.createFolder}
          onMove={move}
          onLock={vault.lock}
        />
      </aside>
      <div class="flex min-w-0 flex-1">
        <section
          class="flex min-w-0 flex-1 flex-col border-r border-edge-muted"
          classList={{ 'max-sm:hidden': detailOpen() }}
        >
          <header class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-edge-muted px-3">
            <Button
              variant="ghost"
              class="lg:hidden"
              onClick={() => setShowNavigation(!showNavigation())}
            >
              {t('passwords.navigation')}
            </Button>
            <h2 class="min-w-0 truncate font-medium max-lg:hidden">
              {collectionName()}
            </h2>
            <Button variant="secondary" onClick={vault.createItem}>
              {t('passwords.newItem')}
            </Button>
          </header>
          <Show when={showNavigation()}>
            <div class="max-h-[55vh] overflow-auto border-b border-edge-muted lg:hidden">
              <VaultSidebar
                items={vault.items.isPending ? [] : (vault.items.data ?? [])}
                folders={folders()}
                filter={vault.filter()}
                onFilter={(filter) => {
                  vault.setFilter(filter);
                  setShowNavigation(false);
                }}
                onCreate={() => {
                  vault.createItem();
                  setShowNavigation(false);
                }}
                onFolder={vault.createFolder}
                onMove={move}
                onLock={vault.lock}
              />
            </div>
          </Show>
          <div class="p-3">
            <Input
              type="search"
              aria-label={t('passwords.search')}
              placeholder={t('passwords.search')}
              value={vault.search()}
              onInput={(event) => vault.setSearch(event.currentTarget.value)}
            />
          </div>
          <div class="mx-1 grid grid-cols-[1fr_5rem_5rem_1rem] gap-2 border-x border-transparent px-3 py-2 text-xs text-ink-muted max-md:hidden">
            <span>{t('passwords.name')}</span>
            <span>{t('passwords.sharedWith')}</span>
            <span class="text-right">{t('passwords.lastUsed')}</span>
            <span aria-hidden="true" />
          </div>
          <div class="flex-1 overflow-auto p-1 touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+1rem)]">
            <Switch>
              <Match when={vault.items.isPending}>
                <p class="p-4 text-ink-muted">{t('passwords.loading')}</p>
              </Match>
              <Match when={vault.items.isError && !vault.items.data}>
                <div class="p-4">
                  <p role="alert">{t('passwords.failed')}</p>
                  <Button onClick={() => vault.items.refetch()}>
                    {t('passwords.retry')}
                  </Button>
                </div>
              </Match>
              <Match
                when={
                  !vault.items.isPending && vault.visibleItems().length === 0
                }
              >
                <p class="p-4 text-ink-muted">{t('passwords.empty')}</p>
              </Match>
            </Switch>
            <For each={vault.visibleItems()}>
              {(item) => (
                <div
                  draggable="true"
                  onDragStart={(event) =>
                    event.dataTransfer?.setData(
                      'application/x-macro-password',
                      item.id
                    )
                  }
                >
                  <Button
                    variant="ghost"
                    class="min-h-14 w-full justify-start rounded-lg px-3 text-left"
                    aria-pressed={vault.selected()?.id === item.id}
                    onClick={() => vault.select(item)}
                  >
                    <Logo item={item} source={source} />
                    <div class="min-w-0 flex-1">
                      <div class="truncate font-medium">{item.name}</div>
                      <div class="truncate text-xs text-ink-muted">
                        {t(`passwords.${item.kind}`)} · {item.url}
                      </div>
                    </div>
                    <span class="w-20 shrink-0 text-xs text-ink-muted max-md:hidden">
                      <Show
                        when={item.shareCount > 0}
                        fallback={t('passwords.onlyYou')}
                      >
                        <span class="inline-flex items-center gap-1">
                          <UsersIcon class="size-4 shrink-0" />
                          {t('passwords.shareCount', {
                            count: item.shareCount,
                          })}
                        </span>
                      </Show>
                    </span>
                    <span class="w-20 shrink-0 text-right text-xs text-ink-muted max-md:hidden">
                      {item.lastUsedAt
                        ? new Intl.DateTimeFormat(formatLocale(), {
                            month: 'short',
                            day: 'numeric',
                          }).format(new Date(item.lastUsedAt))
                        : t('passwords.neverUsed')}
                    </span>
                    <span class="w-4 shrink-0 text-center">
                      <Show when={item.favorite}>
                        <span aria-label={t('passwords.favorite')}>☆</span>
                      </Show>
                    </span>
                  </Button>
                </div>
              )}
            </For>
          </div>
        </section>
        <section
          class="flex min-w-0 flex-[1.1] flex-col"
          classList={{ 'max-sm:hidden': !detailOpen() }}
        >
          <header class="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-edge-muted p-3">
            <Button
              variant="ghost"
              class="sm:hidden"
              onClick={() => vault.select(undefined)}
            >
              {t('passwords.back')}
            </Button>
            <Show
              when={!vault.draft() && vault.selected()}
              keyed
              fallback={
                <span class="flex-1 text-sm text-ink-muted">
                  {vault.draft() ? t('passwords.edit') : t('passwords.select')}
                </span>
              }
            >
              {(item) => (
                <div class="flex min-w-0 flex-1 basis-48 items-center gap-3">
                  <Logo item={item} source={source} large />
                  <div class="min-w-0 flex-1">
                    <h2 class="break-words text-lg font-semibold">
                      {item.name}
                    </h2>
                    <p class="text-xs text-ink-muted">
                      {folders().find((folder) => folder.id === item.folderId)
                        ?.name ?? t('passwords.noFolder')}{' '}
                      / {t(`passwords.${item.kind}`)}
                    </p>
                  </div>
                  <Dropdown>
                    <Dropdown.Trigger
                      variant="secondary"
                      size="icon-sm"
                      aria-label={t('passwords.moreActions')}
                    >
                      <DotsThreeIcon class="size-4" />
                    </Dropdown.Trigger>
                    <Dropdown.Content>
                      <Dropdown.Item onSelect={vault.loadActivity}>
                        {t('passwords.activity')}
                      </Dropdown.Item>
                      <Dropdown.Item onSelect={() => setDeletePending(true)}>
                        {t('passwords.delete')}
                      </Dropdown.Item>
                    </Dropdown.Content>
                  </Dropdown>
                </div>
              )}
            </Show>
            <Show
              when={vault.draft()}
              fallback={
                <Show when={vault.selected()}>
                  <div
                    role="group"
                    aria-label={t('passwords.itemActions')}
                    class="ml-auto flex shrink-0 items-center gap-2"
                  >
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        setDeletePending(false);
                        await vault.edit();
                      }}
                    >
                      {t('passwords.edit')}
                    </Button>
                    <ShareMenu
                      recipients={recipients()}
                      recipientsLoading={recipientsLoading()}
                      recipientsError={recipientsError()}
                      onShare={vault.share}
                      loadGrants={() =>
                        vault.selected()
                          ? source.grants(vault.selected()?.id ?? '')
                          : Promise.resolve(err('failed' as const))
                      }
                    />
                  </div>
                </Show>
              }
            >
              <div class="flex gap-1">
                <Button
                  variant="ghost"
                  disabled={vault.busy()}
                  onClick={vault.cancel}
                >
                  {t('passwords.cancel')}
                </Button>
                <Button
                  variant="accent"
                  disabled={vault.busy()}
                  onClick={vault.save}
                >
                  {t('passwords.save')}
                </Button>
              </div>
            </Show>
          </header>
          <Show when={deletePending() && !vault.draft()}>
            <div
              role="alert"
              class="flex shrink-0 flex-wrap gap-2 border-b border-edge-muted p-3"
            >
              <p class="w-full">{t('passwords.confirmDelete')}</p>
              <Button
                variant="danger"
                onClick={async () => {
                  await vault.remove();
                  setDeletePending(false);
                }}
              >
                {t('passwords.delete')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setDeletePending(false)}
              >
                {t('passwords.cancel')}
              </Button>
            </div>
          </Show>
          <div
            data-passwords-detail-scroll
            class="flex-1 overflow-auto p-6 max-sm:p-4 touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+1rem)]"
          >
            <Show when={vault.failure()}>
              <div role="alert" class="mb-4 text-failure">
                <p>
                  {vault.failure() === 'reauth'
                    ? t('passwords.reauth')
                    : t('passwords.failed')}
                </p>
                <Show when={vault.failure() === 'reauth'}>
                  <a
                    href={`/app/login?redirect=${encodeURIComponent('/passwords')}&prompt=login&max_age=0`}
                  >
                    {t('passwords.signIn')}
                  </a>
                </Show>
              </div>
            </Show>
            <Show when={vault.pendingSelection()}>
              <div
                role="alert"
                class="mb-4 flex flex-wrap gap-2 rounded-lg border border-edge-muted p-3"
              >
                <p class="w-full">{t('passwords.unsaved')}</p>
                <Button variant="secondary" onClick={vault.discard}>
                  {t('passwords.discard')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => vault.setPendingSelection(undefined)}
                >
                  {t('passwords.keepEditing')}
                </Button>
              </div>
            </Show>
            <Show
              when={vault.draft()}
              fallback={
                <Show
                  when={vault.selected()}
                  keyed
                  fallback={
                    <p class="text-ink-muted">{t('passwords.select')}</p>
                  }
                >
                  {(item) => (
                    <>
                      <div class="space-y-5">
                        <Field
                          label={t('passwords.username')}
                          value={
                            vault.username() ??
                            (vault.usernameLoading()
                              ? t('passwords.loadingUsername')
                              : t('passwords.usernameUnavailable'))
                          }
                          emptyLabel={t('passwords.noUsername')}
                          copyDisabled={
                            vault.username() === undefined ||
                            vault.username() === ''
                          }
                          copied={vault.usernameCopied()}
                          onCopy={vault.copyUsername}
                        />
                        <div class="border-b border-edge-muted pb-4">
                          <div class="mb-2 text-xs text-ink-muted">
                            {t('passwords.password')}
                          </div>
                          <div class="flex items-center gap-2">
                            <span class="min-w-0 flex-1 break-all font-mono">
                              {vault.values()?.password ?? '••••••••••••••••'}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={
                                vault.values()
                                  ? t('passwords.hide')
                                  : t('passwords.reveal')
                              }
                              tooltip={
                                vault.values()
                                  ? t('passwords.hide')
                                  : t('passwords.reveal')
                              }
                              onClick={() =>
                                vault.values() ? vault.lock() : vault.reveal()
                              }
                            >
                              <Show
                                when={vault.values()}
                                fallback={<EyeIcon class="size-4" />}
                              >
                                <EyeSlashIcon class="size-4" />
                              </Show>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={
                                vault.copied()
                                  ? t('passwords.copied')
                                  : t('passwords.copy')
                              }
                              tooltip={
                                vault.copied()
                                  ? t('passwords.copied')
                                  : t('passwords.copy')
                              }
                              onClick={vault.copy}
                            >
                              <Show
                                when={vault.copied()}
                                fallback={<CopyIcon class="size-4" />}
                              >
                                <CheckIcon class="size-4" />
                              </Show>
                            </Button>
                          </div>
                          <Show when={!vault.values() && !vault.copied()}>
                            <p class="mt-2 text-xs text-ink-muted">
                              {t('passwords.recentSignIn')}
                            </p>
                          </Show>
                        </div>
                        <Show when={item.hasTotp}>
                          <div>
                            <div class="text-xs text-ink-muted">
                              {t('passwords.totp')}
                            </div>
                            <Show
                              when={vault.code()}
                              keyed
                              fallback={
                                <Button
                                  variant="secondary"
                                  onClick={vault.loadCode}
                                >
                                  {t('passwords.loadCode')}
                                </Button>
                              }
                            >
                              {(code) => (
                                <div>
                                  <output class="font-mono text-2xl tracking-widest">
                                    {code.code}
                                  </output>
                                  <p class="text-xs text-ink-muted">
                                    {t('passwords.seconds', {
                                      count: Math.max(
                                        0,
                                        Math.ceil(
                                          (Date.parse(code.validUntil) -
                                            now()) /
                                            1000
                                        )
                                      ),
                                    })}
                                  </p>
                                </div>
                              )}
                            </Show>
                          </div>
                        </Show>
                        <Field
                          label={t('passwords.website')}
                          value={item.url ?? '—'}
                        />
                        <Field
                          label={t('passwords.notes')}
                          value={vault.values()?.notes ?? '••••••••'}
                        />
                        <For each={vault.values()?.fields ?? []}>
                          {(field) => (
                            <Field label={field.label} value={field.value} />
                          )}
                        </For>
                        <Field
                          label={t('passwords.sharedWith')}
                          value={
                            item.shareCount > 0
                              ? t('passwords.shareCount', {
                                  count: item.shareCount,
                                })
                              : t('passwords.onlyYou')
                          }
                        />
                        <div class="flex flex-wrap gap-2">
                          <Dropdown>
                            <Dropdown.Trigger variant="secondary">
                              {t('passwords.move')}
                            </Dropdown.Trigger>
                            <Dropdown.Content>
                              <Dropdown.Item
                                onSelect={() => vault.move(item, null)}
                              >
                                {t('passwords.noFolder')}
                              </Dropdown.Item>
                              <For each={folders()}>
                                {(folder) => (
                                  <Dropdown.Item
                                    onSelect={() => vault.move(item, folder.id)}
                                  >
                                    {folder.name}
                                  </Dropdown.Item>
                                )}
                              </For>
                            </Dropdown.Content>
                          </Dropdown>
                          <Dropdown>
                            <Dropdown.Trigger variant="secondary">
                              {t('passwords.history')}
                            </Dropdown.Trigger>
                            <Dropdown.Content>
                              <Dropdown.Item onSelect={vault.loadHistory}>
                                {t('passwords.history')}
                              </Dropdown.Item>
                              <For each={vault.history()}>
                                {(version) => (
                                  <Dropdown.Item
                                    onSelect={() =>
                                      vault.reveal(version.version)
                                    }
                                  >
                                    {t('passwords.version', {
                                      version: version.version,
                                    })}{' '}
                                    · {version.createdAt}
                                  </Dropdown.Item>
                                )}
                              </For>
                            </Dropdown.Content>
                          </Dropdown>
                          <Dropdown>
                            <Dropdown.Trigger variant="secondary">
                              {item.hasTotp
                                ? t('passwords.replaceTotp')
                                : t('passwords.setupTotp')}
                            </Dropdown.Trigger>
                            <Dropdown.Content>
                              <div class="flex min-w-64 max-w-[80vw] flex-col gap-2 p-3">
                                <Input
                                  type="password"
                                  autocomplete="off"
                                  aria-label={t('passwords.totpKey')}
                                  value={totpKey()}
                                  onInput={(event) =>
                                    setTotpKey(event.currentTarget.value)
                                  }
                                />
                                <Button
                                  variant="secondary"
                                  onClick={async () => {
                                    if (await vault.setTotp(totpKey()))
                                      setTotpKey('');
                                  }}
                                >
                                  {t('passwords.save')}
                                </Button>
                                <Show when={item.hasTotp}>
                                  <Button
                                    variant="danger"
                                    onClick={() => vault.setTotp('')}
                                  >
                                    {t('passwords.removeTotp')}
                                  </Button>
                                </Show>
                              </div>
                            </Dropdown.Content>
                          </Dropdown>
                        </div>
                        <For each={vault.activity()}>
                          {(activity) => (
                            <p class="py-1 text-xs text-ink-muted">
                              {t(`passwords.event_${activity.action}`)} ·{' '}
                              {new Intl.DateTimeFormat(formatLocale(), {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              }).format(new Date(activity.occurredAt))}
                            </p>
                          )}
                        </For>
                      </div>
                    </>
                  )}
                </Show>
              }
            >
              {(draft) => (
                <CredentialEditor
                  draft={draft()}
                  folders={folders()}
                  validation={vault.validation()}
                  onChange={vault.setDraft}
                />
              )}
            </Show>
            <p class="mt-8 text-xs text-ink-muted">{t('passwords.trust')}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
function Field(props: {
  label: string;
  value: string;
  onCopy?: () => Promise<void>;
  emptyLabel?: string;
  copyDisabled?: boolean;
  copied?: boolean;
}) {
  return (
    <div class="border-b border-edge-muted pb-4">
      <div class="mb-2 text-xs text-ink-muted">{props.label}</div>
      <div class="flex items-center gap-2">
        <span class="min-w-0 flex-1 break-all whitespace-pre-wrap">
          {props.value || props.emptyLabel || '—'}
        </span>
        <Show when={props.onCopy}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('passwords.copyUsername')}
            tooltip={
              props.copied ? t('passwords.copied') : t('passwords.copyUsername')
            }
            disabled={props.copyDisabled}
            onClick={props.onCopy}
          >
            <Show when={props.copied} fallback={<CopyIcon class="size-4" />}>
              <CheckIcon class="size-4" />
            </Show>
          </Button>
        </Show>
      </div>
    </div>
  );
}
function Logo(props: {
  item: PasswordItem;
  source: ReturnType<typeof usePasswords>['source'];
  large?: boolean;
}) {
  const [logo, setLogo] = createSignal<string>();
  let generation = 0;
  async function load(url: string | null, expectedGeneration: number) {
    if (!url) return;
    const result = await props.source.logo(new URL(url).hostname);
    if (result.isErr()) return;
    if (expectedGeneration !== generation) {
      URL.revokeObjectURL(result.value);
      return;
    }
    setLogo(result.value);
  }
  createEffect(
    on(
      () => props.item.url,
      (url) => {
        generation++;
        const previous = logo();
        if (previous) URL.revokeObjectURL(previous);
        setLogo(undefined);
        fireAndForget(load(url, generation), 'passwords-logo');
      }
    )
  );
  onCleanup(() => {
    generation++;
    const value = logo();
    if (value) URL.revokeObjectURL(value);
  });
  return (
    <div
      class="flex shrink-0 items-center justify-center rounded-lg border border-edge-muted bg-panel"
      classList={{ 'size-11': props.large, 'size-9': !props.large }}
    >
      <Show
        when={logo()}
        fallback={
          <span>{props.item.name.slice(0, 1).toLocaleUpperCase()}</span>
        }
      >
        {(url) => <img class="size-6 object-contain" src={url()} alt="" />}
      </Show>
    </div>
  );
}
