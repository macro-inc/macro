import { type TranslationKey, t } from '@app/lib/i18n';
import { beginInteraction, TraceFlow, useFlow } from '@app/observability/flow';
import { startUiOperation } from '@app/observability/ui-operation';
import { useEmail } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import type { Span } from '@macro-inc/observability';
import {
  currentQueryAccount,
  isCurrentQueryAccount,
  queryAccountSession,
} from '@queries/auth/account-scope';
import { imapConnect, imapDiscover } from '@queries/email/imap';
import type { Discovery, Endpoint } from '@service-email/generated/schemas';
import {
  Button,
  Dialog,
  Input,
  type ManagedDialogProps,
  openDialog,
  Panel,
  SecretInput,
} from '@ui';
import {
  createEffect,
  createSignal,
  createUniqueId,
  type Owner,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

type ConnectOutcome = 'connected' | 'payment_required' | 'GMAIL' | 'OUTLOOK';

function blankEndpoint(email: string, port: number): Endpoint {
  return { host: '', port, tls: 'implicit', username: email };
}

function EndpointFields(props: {
  protocol: 'IMAP' | 'SMTP';
  endpoint: Endpoint;
  onChange: (endpoint: Endpoint) => void;
}) {
  const implicit = props.protocol === 'IMAP' ? 993 : 465;
  const startTls = props.protocol === 'IMAP' ? 143 : 587;
  return (
    <fieldset class="flex flex-col gap-2">
      <legend class="mb-1 text-sm font-semibold">
        {props.protocol === 'IMAP' ? t('imap.incoming') : t('imap.outgoing')}
      </legend>
      <label class="grid gap-1 text-sm">
        {t('imap.serverName')}
        <Input
          required
          autocapitalize="none"
          spellcheck={false}
          value={props.endpoint.host}
          onInput={(event) =>
            props.onChange({
              ...props.endpoint,
              host: event.currentTarget.value.trim(),
            })
          }
        />
      </label>
      <label class="grid gap-1 text-sm">
        {t('imap.connection')}
        <select
          class="rounded border border-edge-frame bg-control px-3 py-2 text-ink"
          value={props.endpoint.port}
          onChange={(event) => {
            const port = Number(event.currentTarget.value);
            props.onChange({
              ...props.endpoint,
              port,
              tls: port === implicit ? 'implicit' : 'start_tls',
            });
          }}
        >
          <option value={implicit}>
            {t('imap.tlsPort', { port: String(implicit) })}
          </option>
          <option value={startTls}>
            {t('imap.startTlsPort', { port: String(startTls) })}
          </option>
        </select>
      </label>
      <label class="grid gap-1 text-sm">
        {t('imap.username')}
        <Input
          required
          autocapitalize="none"
          spellcheck={false}
          value={props.endpoint.username}
          onInput={(event) =>
            props.onChange({
              ...props.endpoint,
              username: event.currentTarget.value,
            })
          }
        />
      </label>
    </fieldset>
  );
}

function connectionError(code?: string): TranslationKey {
  switch (code) {
    case 'address_unverified':
      return 'imap.addressUnverified';
    case 'provider_conflict':
      return 'imap.providerConflict';
    case 'connection_changed':
      return 'imap.connectionChanged';
    case 'disabled':
      return 'imap.disabled';
    case 'credentials_rejected':
      return 'imap.credentialsRejected';
    case 'dns_unavailable':
      return 'imap.dnsUnavailable';
    case 'tcp_unavailable':
      return 'imap.tcpUnavailable';
    case 'tls_unavailable':
      return 'imap.tlsUnavailable';
    case 'connection_timed_out':
      return 'imap.timedOut';
    case 'invalid':
    case 'forbidden':
      return 'imap.invalidSettings';
    case 'throttled':
      return 'imap.throttled';
    default:
      return 'imap.connectionUnavailable';
  }
}

type ImapConnectProps = ManagedDialogProps & {
  emailAddress?: string;
  linkId?: string;
  onResult: (value: ConnectOutcome) => void;
};

export function ImapConnectDialog(props: ImapConnectProps) {
  return (
    <TraceFlow
      name="email.imap.setup"
      attributes={props.linkId ? { 'email.link_id': props.linkId } : undefined}
    >
      <ConnectForm {...props} />
    </TraceFlow>
  );
}

function ConnectForm(props: ImapConnectProps) {
  const flow = useFlow();
  const viewerEmail = useEmail();
  const viewer = currentQueryAccount();
  const [email, setEmail] = createSignal(
    props.emailAddress ?? viewerEmail() ?? ''
  );
  const [phase, setPhase] = createSignal<'address' | 'servers'>('address');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<TranslationKey>();
  const [discovery, setDiscovery] = createSignal<Discovery>();
  const [imap, setImap] = createSignal(blankEndpoint(email(), 993));
  const [smtp, setSmtp] = createSignal(blankEndpoint(email(), 465));
  const [separatePassword, setSeparatePassword] = createSignal(false);
  const [confirmed, setConfirmed] = createSignal(false);
  const [manual, setManual] = createSignal(false);
  const passwordId = createUniqueId();
  const smtpPasswordId = createUniqueId();
  const [password, setPassword] = createSignal('');
  const [smtpPassword, setSmtpPassword] = createSignal('');
  let controller: AbortController | undefined;
  let requestId = crypto.randomUUID();

  function clearPasswords() {
    setPassword('');
    setSmtpPassword('');
  }

  onCleanup(() => {
    controller?.abort();
    clearPasswords();
  });

  createEffect(() => {
    if (
      !viewer ||
      viewer.session !== queryAccountSession() ||
      !isCurrentQueryAccount(viewer)
    ) {
      controller?.abort();
      clearPasswords();
      props.onOpenChange(false);
    }
  });

  function changeSettings() {
    setConfirmed(false);
    clearPasswords();
    setError(undefined);
    requestId = crypto.randomUUID();
  }

  async function discover(parent: Span) {
    if (busy() || !isCurrentQueryAccount(viewer)) return;
    const address = email().trim();
    setEmail(address);
    setBusy(true);
    setError(undefined);
    controller?.abort();
    const read = new AbortController();
    controller = read;
    try {
      const result = await imapDiscover(address, read.signal, parent);
      if (read.signal.aborted || !isCurrentQueryAccount(viewer)) return;
      if (result.isErr()) {
        parent.error('discovery_failed');
        setError(
          connectionError(
            result.error.find((e) => e.code === 'IMAP_CONNECTION_REFUSED')
              ?.message
          )
        );
        return;
      }
      const found = result.value;
      setDiscovery(found);
      setImap(found?.imap ?? blankEndpoint(address, 993));
      setSmtp(found?.smtp ?? blankEndpoint(address, 465));
      setManual(!found?.imap || !found?.smtp);
      setPhase('servers');
    } finally {
      if (!read.signal.aborted) setBusy(false);
    }
  }

  onMount(() => {
    if (props.emailAddress)
      fireAndForget(
        flow.task('email.imap.discover', discover),
        'imap-discovery'
      );
  });

  async function connect(parent: Span) {
    if (
      busy() ||
      !confirmed() ||
      !isCurrentQueryAccount(viewer) ||
      password() === '' ||
      (separatePassword() && smtpPassword() === '')
    )
      return;
    setBusy(true);
    setError(undefined);
    const attempt = new AbortController();
    controller = attempt;
    try {
      const result = await imapConnect(
        {
          requestId,
          linkId: props.linkId,
          email: email().trim(),
          imap: { endpoint: imap(), password: password() },
          smtp: {
            endpoint: smtp(),
            password: separatePassword() ? smtpPassword() : password(),
          },
          confirmedHosts: [...new Set([imap().host, smtp().host])],
        },
        attempt.signal,
        parent
      );
      if (attempt.signal.aborted || !isCurrentQueryAccount(viewer)) return;
      if (result.isOk()) {
        if (result.value?.linkId)
          parent.setAttr('email.link_id', result.value.linkId);
        props.onResult('connected');
        return;
      }
      const code = result.error.find(
        (e) => e.code === 'IMAP_CONNECTION_REFUSED'
      )?.message;
      if (code === 'payment_required') props.onResult('payment_required');
      else setError(connectionError(code));
      // A definitive refusal is a new verification on next submit. A lost
      // response keeps its id so the server can return the completed link.
      if (
        code &&
        ![
          'connection_unavailable',
          'dns_unavailable',
          'tcp_unavailable',
          'tls_unavailable',
          'connection_timed_out',
        ].includes(code)
      )
        requestId = crypto.randomUUID();
    } finally {
      clearPasswords();
      if (!attempt.signal.aborted) setBusy(false);
    }
  }

  async function submit(event: SubmitEvent) {
    const discovering = phase() === 'address';
    const operation = startUiOperation(
      discovering ? 'email.imap.discover' : 'email.imap.connect',
      {
        event,
        attributes: props.linkId
          ? { 'email.link_id': props.linkId }
          : undefined,
      }
    );
    try {
      await operation.run(() =>
        discovering ? discover(operation.span) : connect(operation.span)
      );
      if (error()) operation.finish('error');
      else operation.afterPaint();
    } catch (e) {
      operation.finish('error');
      throw e;
    }
  }

  const steer = () => discovery()?.steer?.toLowerCase();
  const oauthProvider = () => {
    switch (steer()) {
      case 'gmail':
        return { code: 'GMAIL', name: 'Google' } as const;
      case 'outlook':
        return { code: 'OUTLOOK', name: 'Microsoft' } as const;
    }
  };
  const canUsePassword = () => {
    if (steer() === 'gmail') return !!props.linkId;
    return steer() !== 'outlook' && steer() !== 'none';
  };
  const helpUrl = () => {
    const value = discovery()?.helpUrl;
    if (!value) return;
    try {
      const url = new URL(value);
      if (url.protocol === 'https:') return url.href;
    } catch {
      return;
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      position="center"
      fullscreen={isMobile()}
      class={isMobile() ? 'pt-(--safe-top) pb-(--safe-bottom)' : 'w-118'}
    >
      <Panel
        depth={2}
        class={isMobile() ? 'h-full' : 'max-h-[85dvh] rounded-xl'}
      >
        <Panel.Header class="px-5">
          <Dialog.Title class="font-semibold">
            {props.linkId ? t('imap.reconnect') : t('imap.connectEmail')}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body scroll class="p-5">
          <form
            class="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              fireAndForget(submit(event), 'imap-connection');
            }}
          >
            <fieldset disabled={busy()} class="flex flex-col gap-4">
              <label class="grid gap-1 text-sm">
                {t('imap.emailAddress')}
                <Input
                  type="email"
                  required
                  readOnly={!!props.linkId || phase() === 'servers'}
                  value={email()}
                  onInput={(event) => setEmail(event.currentTarget.value)}
                />
              </label>
              <Show when={phase() === 'servers'}>
                <Show when={!props.linkId}>
                  <Button
                    type="button"
                    variant="ghost"
                    class="self-start"
                    onClick={() => {
                      changeSettings();
                      setPhase('address');
                      setDiscovery(undefined);
                    }}
                  >
                    {t('imap.changeAddress')}
                  </Button>
                </Show>
                <Show when={oauthProvider()}>
                  {(provider) => (
                    <Button
                      type="button"
                      variant={canUsePassword() ? 'secondary' : 'primary'}
                      onClick={() => props.onResult(provider().code)}
                    >
                      {t('imap.continueWith', { provider: provider().name })}
                    </Button>
                  )}
                </Show>
                <Show when={steer() === 'gmail' && !props.linkId}>
                  <p class="text-sm text-ink-muted">
                    {t('imap.googlePermissions')}
                  </p>
                </Show>
                <Show when={steer() === 'none'}>
                  <p class="text-sm text-ink-muted">
                    {t('imap.noMailbox', {
                      provider: discovery()?.provider ?? '',
                    })}
                  </p>
                </Show>
                <Show when={canUsePassword()}>
                  <Show when={!!discovery()?.provider}>
                    <span class="text-sm font-medium">
                      {discovery()?.provider}
                    </span>
                  </Show>
                  <details
                    open={manual()}
                    onToggle={(event) => setManual(event.currentTarget.open)}
                  >
                    <summary class="text-sm font-medium">
                      {t('imap.serverSettings')}
                    </summary>
                    <div class="mt-3 grid gap-4 sm:grid-cols-2">
                      <EndpointFields
                        protocol="IMAP"
                        endpoint={imap()}
                        onChange={(value) => {
                          changeSettings();
                          setImap(value);
                        }}
                      />
                      <EndpointFields
                        protocol="SMTP"
                        endpoint={smtp()}
                        onChange={(value) => {
                          changeSettings();
                          setSmtp(value);
                        }}
                      />
                    </div>
                  </details>
                  <label class="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      required
                      disabled={!imap().host || !smtp().host}
                      checked={confirmed()}
                      onChange={(event) => {
                        setConfirmed(event.currentTarget.checked);
                        clearPasswords();
                      }}
                    />
                    <span>
                      {imap().host === smtp().host
                        ? t('imap.trustServer', {
                            server: imap().host || t('imap.incomingServer'),
                          })
                        : t('imap.trustServers', {
                            incoming: imap().host || t('imap.incomingServer'),
                            outgoing: smtp().host || t('imap.outgoingServer'),
                          })}
                    </span>
                  </label>
                  <Show when={helpUrl()}>
                    {(url) => (
                      <a
                        class="text-sm text-accent hover:underline"
                        href={url()}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t('imap.appPasswordHelp')}
                      </a>
                    )}
                  </Show>
                  <div class="grid gap-1 text-sm">
                    <label for={passwordId}>{t('imap.password')}</label>
                    <SecretInput
                      id={passwordId}
                      required
                      disabled={!confirmed() || busy()}
                      autocomplete="current-password"
                      value={password()}
                      onValueChange={setPassword}
                    />
                  </div>
                  <label class="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={separatePassword()}
                      onChange={(event) => {
                        setSmtpPassword('');
                        setSeparatePassword(event.currentTarget.checked);
                      }}
                    />
                    {t('imap.separatePassword')}
                  </label>
                  <Show when={separatePassword()}>
                    <div class="grid gap-1 text-sm">
                      <label for={smtpPasswordId}>
                        {t('imap.outgoingPassword')}
                      </label>
                      <SecretInput
                        id={smtpPasswordId}
                        required
                        disabled={!confirmed() || busy()}
                        autocomplete="current-password"
                        value={smtpPassword()}
                        onValueChange={setSmtpPassword}
                      />
                    </div>
                  </Show>
                </Show>
              </Show>
              <div class="min-h-[3lh] text-sm">
                <Show when={error()}>
                  {(key) => (
                    <p role="alert" class="text-failure">
                      {t(key())}
                    </p>
                  )}
                </Show>
              </div>
            </fieldset>
            <div class="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => props.onOpenChange(false)}
              >
                {t('imap.cancel')}
              </Button>
              <Show when={phase() === 'address' || canUsePassword()}>
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy()}
                  disabled={phase() === 'servers' && !confirmed()}
                >
                  {phase() === 'address'
                    ? t('imap.findSettings')
                    : t('imap.connectInbox')}
                </Button>
              </Show>
            </div>
          </form>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}

export async function openImapConnection(
  owner: Owner | null,
  emailAddress?: string,
  linkId?: string
) {
  let outcome: ConnectOutcome | undefined;
  const interaction = beginInteraction('email.imap.setup.open', {
    attributes: linkId ? { 'email.link_id': linkId } : undefined,
  });
  let closed: Promise<unknown>;
  try {
    const dialog = openDialog(
      ImapConnectDialog,
      {
        emailAddress,
        linkId,
        onResult(value) {
          outcome = value;
          dialog.close();
        },
      },
      { owner }
    );
    closed = dialog.closed;
  } finally {
    interaction.end();
  }
  await closed;
  return outcome;
}
