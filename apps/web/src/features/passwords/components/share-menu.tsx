import { t } from '@app/lib/i18n';
import CheckIcon from '@icon/system/regular/check.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { Button, Dropdown, Input } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { PasswordResult } from '../context/passwords-context';
import type { PasswordGrant, PasswordRecipient } from '../core/types';

export function ShareMenu(props: {
  recipients: PasswordRecipient[];
  recipientsLoading: boolean;
  recipientsError: boolean;
  loadGrants: () => PasswordResult<PasswordGrant[]>;
  onShare: (grants: PasswordGrant[]) => Promise<boolean | undefined>;
}) {
  const [loaded, setLoaded] = createSignal(false);
  const [loadError, setLoadError] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [grants, setGrants] = createSignal<PasswordGrant[]>([]);
  const [search, setSearch] = createSignal('');
  const [selection, setSelection] = createSignal<PasswordRecipient>();
  const [permission, setPermission] = createSignal<'view' | 'edit'>('view');
  const selected = () =>
    props.recipients.find(
      (recipient) =>
        recipient.id === selection()?.id && recipient.kind === selection()?.kind
    );
  const matches = () => {
    const query = search().trim().toLocaleLowerCase();
    return props.recipients.filter((recipient) =>
      recipient.name.toLocaleLowerCase().includes(query)
    );
  };
  const recipientName = (grant: PasswordGrant) =>
    props.recipients.find(
      (recipient) => recipient.id === grant.id && recipient.kind === grant.kind
    )?.name ?? t('passwords.unavailableRecipient');
  async function load() {
    setLoaded(false);
    setLoadError(false);
    const result = await props.loadGrants();
    if (result.isErr()) {
      setLoadError(true);
      return;
    }
    setGrants(result.value);
    setLoaded(true);
  }
  async function revoke(grant: PasswordGrant) {
    if (saving()) return;
    setSaving(true);
    const next = grants().filter((value) => value !== grant);
    if (await props.onShare(next)) setGrants(next);
    setSaving(false);
  }
  async function share(event: SubmitEvent) {
    event.preventDefault();
    const recipient = selected();
    if (!recipient || !loaded() || saving()) return;
    const next = [
      ...grants().filter(
        (grant) => grant.id !== recipient.id || grant.kind !== recipient.kind
      ),
      { kind: recipient.kind, id: recipient.id, permission: permission() },
    ];
    setSaving(true);
    if (await props.onShare(next)) {
      setGrants(next);
      setSelection(undefined);
      setSearch('');
    }
    setSaving(false);
  }
  return (
    <Dropdown
      onOpenChange={async (open) => {
        if (open) await load();
      }}
    >
      <Dropdown.Trigger variant="secondary" size="sm">
        <UsersIcon class="size-4" />
        {t('passwords.share')}
      </Dropdown.Trigger>
      <Dropdown.Content>
        <form
          class="flex min-w-64 max-w-[80vw] flex-col gap-3 p-3"
          onSubmit={share}
        >
          <Input
            type="search"
            aria-label={t('passwords.searchRecipients')}
            placeholder={t('passwords.searchRecipients')}
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
          />
          <div
            class="flex max-h-52 flex-col overflow-auto"
            aria-label={t('passwords.selectRecipient')}
          >
            <For each={matches()}>
              {(recipient) => (
                <Button
                  variant="ghost"
                  class="justify-start text-left"
                  aria-pressed={
                    selected()?.id === recipient.id &&
                    selected()?.kind === recipient.kind
                  }
                  onClick={() => setSelection(recipient)}
                >
                  <UsersIcon class="size-4 shrink-0" />
                  <span class="min-w-0 flex-1 whitespace-normal break-words">
                    {recipient.name}
                  </span>
                  <span class="text-xs text-ink-muted">
                    {recipient.kind === 'team'
                      ? t('passwords.team')
                      : t('passwords.person')}
                  </span>
                  <Show
                    when={
                      selected()?.id === recipient.id &&
                      selected()?.kind === recipient.kind
                    }
                  >
                    <CheckIcon class="size-4 shrink-0" />
                  </Show>
                </Button>
              )}
            </For>
            <Show when={props.recipientsLoading}>
              <p class="p-2 text-xs text-ink-muted">
                {t('passwords.loadingRecipients')}
              </p>
            </Show>
            <Show when={!props.recipientsLoading && matches().length === 0}>
              <p class="p-2 text-xs text-ink-muted">
                {t('passwords.noRecipients')}
              </p>
            </Show>
          </div>
          <Show when={props.recipientsError}>
            <p role="alert" class="text-xs text-failure">
              {t('passwords.recipientsError')}
            </p>
          </Show>
          <Show when={loadError()}>
            <p role="alert" class="text-xs text-failure">
              {t('passwords.failed')}
            </p>
          </Show>
          <div class="flex gap-2">
            <Button
              variant="ghost"
              aria-pressed={permission() === 'view'}
              onClick={() => setPermission('view')}
            >
              {t('passwords.view')}
            </Button>
            <Button
              variant="ghost"
              aria-pressed={permission() === 'edit'}
              onClick={() => setPermission('edit')}
            >
              {t('passwords.canEdit')}
            </Button>
          </div>
          <For each={grants()}>
            {(grant) => (
              <div class="flex items-center gap-2 text-xs">
                <span class="min-w-0 flex-1 break-words">
                  {recipientName(grant)}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={saving()}
                  aria-label={t('passwords.revokeRecipient', {
                    name: recipientName(grant),
                  })}
                  onClick={() => revoke(grant)}
                >
                  {t('passwords.revoke')}
                </Button>
              </div>
            )}
          </For>
          <Button
            type="submit"
            variant="secondary"
            disabled={!loaded() || !selected() || saving()}
          >
            {t('passwords.share')}
          </Button>
        </form>
      </Dropdown.Content>
    </Dropdown>
  );
}
