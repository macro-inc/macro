import { formatLocale, type TranslationKey, t } from '@app/lib/i18n';
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
import { Button, Checkbox, Dialog, Panel } from '@ui';
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { SettingsSelect } from './components/settings-select';
import { SettingsButton } from './primitives';

const roleLabels: Record<FolderRole, TranslationKey> = {
  inbox: 'imap.roleInbox',
  sent: 'imap.roleSent',
  drafts: 'imap.roleDrafts',
  archive: 'imap.roleArchive',
  trash: 'imap.roleTrash',
  junk: 'imap.roleJunk',
  other: 'imap.roleOther',
};
const selectableRoles = [
  'sent',
  'drafts',
  'archive',
  'trash',
  'junk',
  'other',
] as const;

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
      props.features.gmailExtensions && t('imap.gmailExtensions'),
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
            <dt class="font-medium">{t('imap.features')}</dt>
            <dd class="text-ink-muted">{names()}</dd>
          </div>
        )}
      </Show>
      <Show when={props.features.sendLimitBytes}>
        {(limit) => (
          <div>
            <dt class="font-medium">{t('imap.messageLimit')}</dt>
            <dd class="text-ink-muted">
              {t('imap.bytes', { count: limit() })}
            </dd>
          </div>
        )}
      </Show>
      <Show when={props.features.verifiedAt}>
        {(date) => (
          <div>
            <dt class="font-medium">{t('imap.lastVerified')}</dt>
            <dd class="text-ink-muted">
              <time dateTime={date()}>
                {new Date(date()).toLocaleString(formatLocale())}
              </time>
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
  const [error, setError] = createSignal<TranslationKey>();

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
      setError('imap.readFailed');
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
    setError(undefined);
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
        if (current()) setError('imap.settingsChanged');
      } else {
        setError(
          code === 'invalid' ? 'imap.invalidFolders' : 'imap.saveFailed'
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

  const actions = () => (
    <div class="flex justify-end gap-2">
      <Button variant="secondary" onClick={props.close}>
        {t('imap.close')}
      </Button>
      <Button
        variant="primary"
        loading={saving()}
        disabled={!settings() || saving()}
        onClick={(event) => fireAndForget(save(event), 'imap-save-settings')}
      >
        {t('imap.saveSettings')}
      </Button>
    </div>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.close();
      }}
      position="center"
      class={isMobile() ? undefined : 'w-128'}
    >
      <Panel
        depth={2}
        class={isMobile() ? undefined : 'max-h-[85dvh] rounded-xl'}
      >
        <Panel.Header class="px-5">
          <Dialog.Title class="font-semibold">
            {t('imap.mailServerSettings')}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body scroll={!isMobile()} class="flex flex-col gap-4 p-5">
          <Dialog.Description class="ph-no-capture text-sm text-ink-muted">
            {props.emailAddress}
          </Dialog.Description>
          <Show
            when={settings()}
            fallback={
              <Show when={!error()}>
                <p class="text-sm">{t('imap.loadingSettings')}</p>
              </Show>
            }
          >
            {(data) => (
              <>
                <dl class="grid gap-4 sm:grid-cols-2">
                  <ServerDetails
                    name={t('imap.incoming')}
                    endpoint={data().imap}
                  />
                  <ServerDetails
                    name={t('imap.outgoing')}
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
                  {t('imap.changeLogin')}
                </Button>
                <Show when={data().helpUrl}>
                  {(url) => (
                    <a
                      class="self-start text-sm underline"
                      href={url()}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {t('imap.setupInstructions', {
                        provider: data().provider ?? t('imap.mailProvider'),
                      })}
                    </a>
                  )}
                </Show>
                <fieldset disabled={saving()} class="flex flex-col gap-3">
                  <legend class="mb-2 font-semibold">
                    {t('imap.folders')}
                  </legend>
                  <Show
                    when={data().folders.length}
                    fallback={
                      <p class="text-sm text-ink-muted">
                        {t('imap.foldersPending')}
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
                          {t('imap.unsyncedFolders', { count: count() })}
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
                              {t('imap.outsideSync')}
                            </span>
                          </Show>
                          <Show
                            when={folder.detectedRole !== 'inbox'}
                            fallback={
                              <span class="text-ink-muted">
                                {t('imap.inboxAlwaysSynced')}
                              </span>
                            }
                          >
                            <div class="flex flex-wrap items-center gap-3">
                              <div class="grid min-w-0 gap-1">
                                <span>{t('imap.role')}</span>
                                <SettingsSelect
                                  label={t('imap.roleFor', {
                                    folder: folder.name,
                                  })}
                                  value={roles()[folder.id] ?? 'automatic'}
                                  disabled={saving()}
                                  options={[
                                    {
                                      id: 'automatic',
                                      name: t('imap.automaticRole', {
                                        role: t(
                                          roleLabels[folder.detectedRole]
                                        ),
                                      }),
                                    },
                                    ...selectableRoles.map((role) => ({
                                      id: role,
                                      name: t(roleLabels[role]),
                                    })),
                                  ]}
                                  onChange={(role) =>
                                    changeRole(folder.id, role)
                                  }
                                />
                              </div>
                              <Checkbox
                                disabled={saving()}
                                checked={!excluded().includes(folder.id)}
                                onChange={(checked) => {
                                  if (checked)
                                    setExcluded((previous) =>
                                      previous.filter((id) => id !== folder.id)
                                    );
                                  else {
                                    setExcluded((previous) => [
                                      ...previous,
                                      folder.id,
                                    ]);
                                    if (watch() === folder.id) setWatch('');
                                  }
                                }}
                              >
                                <Checkbox.Control />
                                <Checkbox.Label>
                                  <span aria-hidden="true">
                                    {t('imap.syncFolder')}
                                  </span>
                                  <span class="sr-only">
                                    {t('imap.syncNamedFolder', {
                                      folder: folder.name,
                                    })}
                                  </span>
                                </Checkbox.Label>
                              </Checkbox>
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                    <div class="grid gap-1 text-sm">
                      <span>{t('imap.watchFolder')}</span>
                      <SettingsSelect
                        label={t('imap.watchFolder')}
                        value={watch() || 'inbox-only'}
                        disabled={saving()}
                        onChange={(id) =>
                          setWatch(id === 'inbox-only' ? '' : id)
                        }
                        options={[
                          { id: 'inbox-only', name: t('imap.inboxOnly') },
                          ...data()
                            .folders.filter(
                              (folder) =>
                                folder.detectedRole !== 'inbox' &&
                                plannedRole(folder) !== 'drafts' &&
                                !excluded().includes(folder.id)
                            )
                            .map((folder) => ({
                              id: folder.id,
                              name: folder.name,
                            })),
                        ]}
                      />
                    </div>
                  </Show>
                </fieldset>
              </>
            )}
          </Show>
          <Show when={error()}>
            {(key) => (
              <p role="alert" class="text-sm text-failure">
                {t(key())}
              </p>
            )}
          </Show>
        </Panel.Body>
        <Dialog.Footer class="justify-end px-5 py-3">{actions()}</Dialog.Footer>
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
        {t('imap.serverSettings')}
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
