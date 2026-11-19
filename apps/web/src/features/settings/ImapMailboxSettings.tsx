import { beginInteraction, TraceFlow, useFlow } from '@app/observability/flow';
import { startUiOperation } from '@app/observability/ui-operation';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import type { Span } from '@macro-inc/observability';
import {
  currentQueryAccount,
  isCurrentQueryAccount,
  queryAccountSession,
} from '@queries/auth/account-scope';
import {
  getImapMailboxSettings,
  updateImapMailboxSettings,
} from '@queries/email/imap';
import type {
  AccountMailSettings,
  Endpoint,
  FolderRole,
  FolderSetting,
  ServerFeatures,
  UpdateFolderSettings,
} from '@service-email/generated/schemas';
import { Button, Dialog, Panel } from '@ui';
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { SettingsButton } from './primitives';

const roleLabels: Record<FolderRole, string> = {
  inbox: 'Inbox',
  sent: 'Sent',
  drafts: 'Drafts',
  archive: 'Archive',
  trash: 'Trash',
  junk: 'Junk',
  other: 'Other',
};
const selectableRoles = [
  'sent',
  'drafts',
  'archive',
  'trash',
  'junk',
  'other',
] as const;
function FolderSelect(props: JSX.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      class="rounded border border-edge-frame bg-control px-2 py-1 text-sm text-ink"
    />
  );
}

function ServerDetails(props: { name: string; endpoint: Endpoint }) {
  return (
    <div class="grid min-w-0 gap-1 text-sm">
      <dt class="font-medium">{props.name}</dt>
      <dd class="ph-no-capture break-words text-ink-muted">
        {props.endpoint.host}:{props.endpoint.port} ·{' '}
        {props.endpoint.tls === 'implicit' ? 'TLS' : 'STARTTLS'}
        <br />
        {props.endpoint.username}
      </dd>
    </div>
  );
}

function VerifiedFeatures(props: { features: ServerFeatures }) {
  const labels = () =>
    [
      props.features.idle && 'IDLE',
      props.features.condstore && 'CONDSTORE',
      props.features.uidPlus && 'UIDPLUS',
      props.features.moveMessages && 'MOVE',
      props.features.objectId && 'OBJECTID',
      props.features.gmailExtensions && 'Gmail extensions',
      props.features.smtpUtf8 && 'SMTPUTF8',
      props.features.eightBitMime && '8BITMIME',
    ]
      .filter(Boolean)
      .join(', ');
  return (
    <dl class="grid gap-2 text-sm">
      <Show when={labels()}>
        {(names) => (
          <div>
            <dt class="font-medium">Server features</dt>
            <dd class="text-ink-muted">{names()}</dd>
          </div>
        )}
      </Show>
      <Show when={props.features.sendLimitBytes}>
        {(limit) => (
          <div>
            <dt class="font-medium">Outgoing message limit</dt>
            <dd class="text-ink-muted">{limit().toLocaleString()} bytes</dd>
          </div>
        )}
      </Show>
      <Show when={props.features.verifiedAt}>
        {(date) => (
          <div>
            <dt class="font-medium">Connection last verified</dt>
            <dd class="text-ink-muted">
              <time dateTime={date()}>{new Date(date()).toLocaleString()}</time>
            </dd>
          </div>
        )}
      </Show>
    </dl>
  );
}

function SettingsDialog(props: {
  linkId: string;
  emailAddress: string;
  close: () => void;
  onReconnect: () => void;
}) {
  const flow = useFlow();
  const viewer = currentQueryAccount();
  const controller = new AbortController();
  const [settings, setSettings] = createSignal<AccountMailSettings>();
  const [roles, setRoles] = createSignal<Record<string, FolderRole>>({});
  const [excluded, setExcluded] = createSignal<string[]>([]);
  const [watch, setWatch] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');

  onCleanup(() => controller.abort());
  createEffect(() => {
    if (
      !viewer ||
      viewer.session !== queryAccountSession() ||
      !isCurrentQueryAccount(viewer)
    )
      props.close();
  });
  function current() {
    return !controller.signal.aborted && isCurrentQueryAccount(viewer);
  }
  async function read(parent: Span) {
    if (!current()) return;
    const result = await getImapMailboxSettings(
      props.linkId,
      controller.signal,
      parent
    );
    if (!current()) return;
    if (result.isErr() || !result.value) {
      parent.error('settings_read_failed');
      setError(
        'Mail settings could not be loaded. Close this window and try again.'
      );
      return;
    }
    const value = result.value;
    setRoles(
      Object.fromEntries(
        value.folders.flatMap((f) =>
          f.roleOverride ? [[f.id, f.roleOverride]] : []
        )
      )
    );
    setExcluded(value.folders.filter((f) => f.excluded).map((f) => f.id));
    setWatch(value.folders.find((f) => f.watched)?.id ?? '');
    setSettings(value);
  }
  onMount(() =>
    fireAndForget(
      flow.task('email.imap.settings.read', read),
      'imap-read-settings'
    )
  );

  async function save(event: Event) {
    const data = settings();
    if (!data || !current() || saving()) return;
    const operation = startUiOperation('email.imap.settings.save', {
      event,
      attributes: { 'email.link_id': props.linkId },
    });
    setSaving(true);
    setError('');
    try {
      const update: UpdateFolderSettings = {
        expectedRevision: data.revision,
        roleOverrides: roles(),
        excludedFolderIds: excluded(),
        watchedFolderIds: watch() ? [watch()] : [],
      };
      const result = await updateImapMailboxSettings(
        props.linkId,
        update,
        controller.signal,
        operation.span
      );
      if (!current()) {
        operation.cancel();
        return;
      }
      if (result.isOk()) {
        props.close();
        operation.afterPaint();
        return;
      }
      const code = result.error.find(
        (e) => e.code === 'IMAP_CONNECTION_REFUSED'
      )?.message;
      if (code === 'conflict' || code === 'connection_changed') {
        await operation.span.span('email.imap.settings.reload', read);
        if (current())
          setError(
            'This inbox changed. Review the current settings and save again.'
          );
      } else {
        setError(
          code === 'invalid'
            ? 'Choose one folder for each role. The inbox must stay included.'
            : 'Could not save mail settings. Try again.'
        );
      }
      operation.finish('error');
    } catch (e) {
      operation.finish('error');
      throw e;
    } finally {
      if (current()) setSaving(false);
    }
  }

  function plannedRole(folder: FolderSetting): FolderRole {
    const overrides = roles();
    const manual = overrides[folder.id];
    if (manual) return manual;
    return Object.values(overrides).includes(folder.detectedRole)
      ? 'other'
      : folder.detectedRole;
  }

  function changeRole(id: string, role: string) {
    setRoles((previous) => {
      const next = { ...previous };
      if (selectableRoles.some((r) => r === role))
        next[id] = role as FolderRole;
      else delete next[id];
      return next;
    });
    const currentWatch = settings()?.folders.find(
      (folder) => folder.id === watch()
    );
    if (currentWatch && plannedRole(currentWatch) === 'drafts') setWatch('');
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.close();
      }}
      fullscreen={isMobile()}
      position="center"
      class={isMobile() ? 'py-(--safe-top)' : 'w-128'}
    >
      <Panel
        depth={2}
        class={isMobile() ? 'h-full' : 'max-h-[85dvh] rounded-xl'}
      >
        <Panel.Header class="px-5">
          <Dialog.Title class="font-semibold">
            Mail server settings
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body scroll class="flex flex-col gap-4 p-5">
          <Dialog.Description class="ph-no-capture text-sm text-ink-muted">
            {props.emailAddress}
          </Dialog.Description>
          <Show
            when={settings()}
            fallback={
              <Show when={!error()}>
                <p class="text-sm">Loading settings…</p>
              </Show>
            }
          >
            {(data) => (
              <>
                <dl class="grid gap-4 sm:grid-cols-2">
                  <ServerDetails
                    name="Incoming mail (IMAP)"
                    endpoint={data().imap}
                  />
                  <ServerDetails
                    name="Outgoing mail (SMTP)"
                    endpoint={data().smtp}
                  />
                </dl>
                <Show when={data().features}>
                  {(features) => <VerifiedFeatures features={features()} />}
                </Show>
                <Button
                  variant="secondary"
                  class="self-start"
                  onClick={() => {
                    props.close();
                    props.onReconnect();
                  }}
                >
                  Change login details
                </Button>
                <Show when={data().helpUrl}>
                  {(url) => (
                    <a
                      class="self-start text-sm underline"
                      href={url()}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {data().provider ?? 'Mail provider'} setup instructions
                    </a>
                  )}
                </Show>
                <fieldset disabled={saving()} class="flex flex-col gap-3">
                  <legend class="mb-2 font-semibold">Folders</legend>
                  <Show
                    when={data().folders.length}
                    fallback={
                      <p class="text-sm text-ink-muted">
                        Folders will appear after the first sync.
                      </p>
                    }
                  >
                    <Show
                      when={
                        data().folders.filter(
                          (folder) =>
                            folder.monitored === false && !folder.excluded
                        ).length
                      }
                    >
                      {(count) => (
                        <p class="text-sm text-ink-muted">
                          {count()}{' '}
                          {count() === 1
                            ? 'included folder was'
                            : 'included folders were'}{' '}
                          outside the last sync. Macro syncs up to 200 physical
                          folders and prioritizes the inbox, assigned roles, and
                          watched folders.
                        </p>
                      )}
                    </Show>
                    <For each={data().folders}>
                      {(folder) => (
                        <div class="grid gap-2 border-t border-edge-frame pt-2 text-sm">
                          <span class="ph-no-capture font-medium">
                            {folder.name}
                          </span>
                          <Show
                            when={
                              folder.monitored === false && !folder.excluded
                            }
                          >
                            <span class="text-ink-muted">
                              Outside the latest sync
                            </span>
                          </Show>
                          <Show
                            when={folder.detectedRole !== 'inbox'}
                            fallback={
                              <span class="text-ink-muted">
                                Inbox · Always synced
                              </span>
                            }
                          >
                            <div class="flex flex-wrap items-center gap-3">
                              <label class="flex items-center gap-2">
                                Role
                                <FolderSelect
                                  aria-label={`Role for ${folder.name}`}
                                  value={roles()[folder.id] ?? ''}
                                  onChange={(e) =>
                                    changeRole(folder.id, e.currentTarget.value)
                                  }
                                >
                                  <option value="">
                                    Automatic ({roleLabels[folder.detectedRole]}
                                    )
                                  </option>
                                  <For each={selectableRoles}>
                                    {(role) => (
                                      <option value={role}>
                                        {roleLabels[role]}
                                      </option>
                                    )}
                                  </For>
                                </FolderSelect>
                              </label>
                              <label class="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  aria-label={`Sync ${folder.name}`}
                                  checked={!excluded().includes(folder.id)}
                                  onChange={(e) => {
                                    if (e.currentTarget.checked)
                                      setExcluded((previous) =>
                                        previous.filter(
                                          (id) => id !== folder.id
                                        )
                                      );
                                    else {
                                      setExcluded((previous) => [
                                        ...previous,
                                        folder.id,
                                      ]);
                                      if (watch() === folder.id) setWatch('');
                                    }
                                  }}
                                />
                                Sync folder
                              </label>
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                    <label class="flex flex-col gap-1 text-sm">
                      Watch for new mail alongside Inbox
                      <FolderSelect
                        value={watch()}
                        onChange={(e) => setWatch(e.currentTarget.value)}
                      >
                        <option value="">Inbox only</option>
                        <For
                          each={data().folders.filter(
                            (f) =>
                              f.detectedRole !== 'inbox' &&
                              plannedRole(f) !== 'drafts' &&
                              !excluded().includes(f.id)
                          )}
                        >
                          {(folder) => (
                            <option value={folder.id}>{folder.name}</option>
                          )}
                        </For>
                      </FolderSelect>
                    </label>
                  </Show>
                </fieldset>
              </>
            )}
          </Show>
          <Show when={error()}>
            <p role="alert" class="text-sm text-failure">
              {error()}
            </p>
          </Show>
          <div class="flex justify-end gap-2">
            <Button variant="secondary" onClick={props.close}>
              Close
            </Button>
            <Button
              variant="primary"
              disabled={!settings() || saving()}
              onClick={(event) =>
                fireAndForget(save(event), 'imap-save-settings')
              }
            >
              {saving() ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}

/** Owner-only action mounted by the connected IMAP inbox row. */
export function ImapMailboxSettings(props: {
  linkId: string;
  emailAddress: string;
  onReconnect: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <>
      <SettingsButton
        size="md"
        variant="secondary"
        onClick={(event) => {
          const interaction = beginInteraction('email.imap.settings.open', {
            event,
            attributes: { 'email.link_id': props.linkId },
          });
          try {
            setOpen(true);
          } finally {
            interaction.end();
          }
        }}
      >
        Server settings
      </SettingsButton>
      <Show when={open()}>
        <TraceFlow
          name="email.imap.settings"
          attributes={{ 'email.link_id': props.linkId }}
        >
          <SettingsDialog
            linkId={props.linkId}
            emailAddress={props.emailAddress}
            close={() => setOpen(false)}
            onReconnect={props.onReconnect}
          />
        </TraceFlow>
      </Show>
    </>
  );
}
