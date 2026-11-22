import { type TranslationKey, t } from '@app/lib/i18n';
import { beginInteraction, TraceFlow, useFlow } from '@app/observability/flow';
import { startUiOperation } from '@app/observability/ui-operation';
import { useEmail } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { Collapsible } from '@kobalte/core/collapsible';
import type { Span } from '@macro-inc/observability';
import {
  currentQueryAccount,
  isCurrentQueryAccount,
  queryAccountSession,
} from '@queries/auth/account-scope';
import { fetchEmailConnectionProviders } from '@queries/auth/outlook-link';
import { imapConnect, imapDiscover } from '@queries/email/imap';
import type { Discovery, Endpoint } from '@service-email/generated/schemas';
import {
  Button,
  Checkbox,
  Dialog,
  Input,
  type ManagedDialogProps,
  openDialog,
  Panel,
  SecretInput,
  Select,
} from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  type Owner,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { match } from 'ts-pattern';

type ConnectOutcome = 'connected' | 'payment_required' | 'GMAIL' | 'OUTLOOK';

function consentProvider(steer: Discovery['steer']) {
  return match(steer ?? undefined)
    .with(
      'gmail',
      () => ({ code: 'GMAIL', name: 'Google', capability: 'gmail' }) as const
    )
    .with(
      'outlook',
      () =>
        ({ code: 'OUTLOOK', name: 'Microsoft', capability: 'outlook' }) as const
    )
    .with('none', () => undefined)
    .with(undefined, () => undefined)
    .exhaustive(() => undefined);
}

function blankEndpoint(email: string, port: number): Endpoint {
  return { host: '', port, tls: 'implicit', username: email };
}

function EndpointFields(props: {
  protocol: 'IMAP' | 'SMTP';
  endpoint: Endpoint;
  discoveredEndpoint?: Endpoint;
  disabled?: boolean;
  onChange: (endpoint: Endpoint) => void;
}) {
  const implicit = props.protocol === 'IMAP' ? 993 : 465;
  const startTls = props.protocol === 'IMAP' ? 143 : 587;
  const tlsForPort = (port: number) => {
    if (port === implicit) return 'implicit';
    if (port === startTls) return 'start_tls';
    return props.discoveredEndpoint?.tls ?? props.endpoint.tls;
  };
  const ports = createMemo(() =>
    [
      ...new Set([
        implicit,
        startTls,
        props.discoveredEndpoint?.port ?? implicit,
      ]),
    ].map((port) => ({
      port,
      tls: tlsForPort(port),
      label: t(
        tlsForPort(port) === 'implicit' ? 'imap.tlsPort' : 'imap.startTlsPort',
        { port: String(port) }
      ),
    }))
  );
  return (
    <fieldset class="flex min-w-0 flex-col gap-2">
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
      <Select<{ port: number; tls: Endpoint['tls']; label: string }>
        class="grid gap-1 text-sm"
        options={ports()}
        value={ports().find((option) => option.port === props.endpoint.port)}
        optionValue="port"
        optionTextValue="label"
        disabled={props.disabled}
        disallowEmptySelection
        onChange={(option) => {
          if (!option) return;
          const { port, tls } = option;
          // Kobalte can re-emit a controlled selection when options change.
          if (port === props.endpoint.port && tls === props.endpoint.tls)
            return;
          props.onChange({ ...props.endpoint, port, tls });
        }}
      >
        <Select.Label>{t('imap.connection')}</Select.Label>
        <Select.Trigger>
          <Select.Value<{ port: number; tls: Endpoint['tls']; label: string }>>
            {(state) => state.selectedOption().label}
          </Select.Value>
          <Select.Icon />
        </Select.Trigger>
        <Select.Content portalScope="local">
          <Select.Listbox />
        </Select.Content>
      </Select>
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
  const [oauthAvailable, setOauthAvailable] = createSignal(false);
  const [passwordSelected, setPasswordSelected] = createSignal(false);
  const [imap, setImap] = createSignal(blankEndpoint(email(), 993));
  const [smtp, setSmtp] = createSignal(blankEndpoint(email(), 465));
  const [separatePassword, setSeparatePassword] = createSignal(false);
  const [confirmed, setConfirmed] = createSignal(false);
  const [manual, setManual] = createSignal(false);
  const formId = createUniqueId();
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

  function startRequest(budgetMs: number, parent: Span) {
    controller?.abort();
    const request = new AbortController();
    controller = request;
    const timer = setTimeout(() => {
      if (request.signal.aborted || !isCurrentQueryAccount(viewer)) return;
      request.abort();
      clearPasswords();
      setBusy(false);
      setError('imap.timedOut');
      parent.error('request_timeout');
    }, budgetMs);
    const finish = () => clearTimeout(timer);
    request.signal.addEventListener('abort', finish, { once: true });
    return { request, finish };
  }

  function cancel() {
    controller?.abort();
    clearPasswords();
    setBusy(false);
    props.onOpenChange(false);
  }

  async function discover(parent: Span) {
    if (busy() || !isCurrentQueryAccount(viewer)) return;
    const address = email().trim();
    setEmail(address);
    setBusy(true);
    setError(undefined);
    // Discovery has a five-second provider budget; allow capability lookup too.
    const { request: read, finish } = startRequest(20_000, parent);
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
      let consentAvailable = false;
      const provider = consentProvider(found?.steer);
      if (!props.linkId && provider) {
        try {
          const providers = await fetchEmailConnectionProviders();
          consentAvailable = providers[provider.capability];
        } catch {
          // Provider consent is optional here; an unavailable capability read
          // keeps the app-password route without authorizing an OAuth flow.
          parent.setAttr('email.oauth_capability', 'unavailable');
        }
      }
      if (read.signal.aborted || !isCurrentQueryAccount(viewer)) return;
      setOauthAvailable(consentAvailable);
      setPasswordSelected(false);
      setDiscovery(found);
      setImap(found?.imap ?? blankEndpoint(address, 993));
      setSmtp(found?.smtp ?? blankEndpoint(address, 465));
      setManual(!found?.imap || !found?.smtp);
      setPhase('servers');
    } catch (cause) {
      if (!read.signal.aborted) throw cause;
    } finally {
      finish();
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
    // The internal client caps verification at 90 seconds. Preserve the
    // request id after a timeout so a retry can recover a completed connect.
    const { request: attempt, finish } = startRequest(95_000, parent);
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
    } catch (cause) {
      if (!attempt.signal.aborted) throw cause;
    } finally {
      finish();
      if (!attempt.signal.aborted && controller === attempt) {
        clearPasswords();
        setBusy(false);
      }
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

  const steer = () => discovery()?.steer;
  const oauthProvider = () => {
    if (props.linkId || !oauthAvailable()) return;
    return consentProvider(steer());
  };
  const canUsePassword = () => {
    return steer() !== 'none' && (!oauthProvider() || passwordSelected());
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

  const actions = () => (
    <div class="flex justify-end gap-2">
      <Button type="button" variant="ghost" onClick={cancel}>
        {t('imap.cancel')}
      </Button>
      <Show when={phase() === 'address' || canUsePassword()}>
        <Button
          type="submit"
          form={formId}
          variant="primary"
          loading={busy()}
          disabled={phase() === 'servers' && !confirmed()}
        >
          {phase() === 'address'
            ? t('imap.findSettings')
            : t(props.linkId ? 'imap.reconnectAction' : 'imap.connectInbox')}
        </Button>
      </Show>
    </div>
  );

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (open || !busy()) props.onOpenChange(open);
      }}
      position="center"
      class={isMobile() ? undefined : 'w-140 max-w-[calc(100vw-2rem)]'}
    >
      <Panel
        depth={2}
        class={isMobile() ? undefined : 'max-h-[85dvh] rounded-xl'}
      >
        <Panel.Header class="px-5">
          <Dialog.Title class="font-semibold">
            {props.linkId ? t('imap.reconnect') : t('imap.connectEmail')}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body scroll={!isMobile()} class="p-5">
          <form
            id={formId}
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
                      variant="primary"
                      onClick={() => props.onResult(provider().code)}
                    >
                      {t('imap.continueWith', { provider: provider().name })}
                    </Button>
                  )}
                </Show>
                <Show when={oauthProvider() && !passwordSelected()}>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      changeSettings();
                      setPasswordSelected(true);
                    }}
                  >
                    {t('imap.useAppPassword')}
                  </Button>
                </Show>
                <Show when={steer() === 'gmail' && !!oauthProvider()}>
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
                  <Collapsible
                    forceMount
                    open={manual()}
                    onOpenChange={setManual}
                  >
                    <Collapsible.Trigger
                      as={Button}
                      type="button"
                      variant="ghost"
                      class="group justify-start"
                    >
                      {t('imap.serverSettings')}
                      <CaretDownIcon class="size-3 group-data-expanded:rotate-180" />
                    </Collapsible.Trigger>
                    <Collapsible.Content class="data-closed:hidden">
                      <div class="mt-3 grid gap-4">
                        <EndpointFields
                          disabled={busy()}
                          protocol="IMAP"
                          discoveredEndpoint={discovery()?.imap ?? undefined}
                          endpoint={imap()}
                          onChange={(value) => {
                            changeSettings();
                            setImap(value);
                          }}
                        />
                        <EndpointFields
                          disabled={busy()}
                          protocol="SMTP"
                          discoveredEndpoint={discovery()?.smtp ?? undefined}
                          endpoint={smtp()}
                          onChange={(value) => {
                            changeSettings();
                            setSmtp(value);
                          }}
                        />
                      </div>
                    </Collapsible.Content>
                  </Collapsible>
                  <Checkbox
                    required
                    disabled={busy() || !imap().host || !smtp().host}
                    checked={confirmed()}
                    onChange={(checked) => {
                      setConfirmed(checked);
                      clearPasswords();
                    }}
                    class="items-start text-sm"
                  >
                    <Checkbox.Control />
                    <Checkbox.Label>
                      {imap().host === smtp().host
                        ? t('imap.trustServer', {
                            server: imap().host || t('imap.incomingServer'),
                          })
                        : t('imap.trustServers', {
                            incoming: imap().host || t('imap.incomingServer'),
                            outgoing: smtp().host || t('imap.outgoingServer'),
                          })}
                    </Checkbox.Label>
                  </Checkbox>
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
                  <Checkbox
                    disabled={busy()}
                    checked={separatePassword()}
                    onChange={(checked) => {
                      setSmtpPassword('');
                      setSeparatePassword(checked);
                    }}
                    class="text-sm"
                  >
                    <Checkbox.Control />
                    <Checkbox.Label>
                      {t('imap.separatePassword')}
                    </Checkbox.Label>
                  </Checkbox>
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
          </form>
        </Panel.Body>
        <Dialog.Footer class="justify-end px-5 py-3">{actions()}</Dialog.Footer>
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
