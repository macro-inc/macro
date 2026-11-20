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
} from '@ui';
import {
  createEffect,
  createSignal,
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
        {props.protocol === 'IMAP'
          ? 'Incoming mail (IMAP)'
          : 'Outgoing mail (SMTP)'}
      </legend>
      <label class="grid gap-1 text-sm">
        Server name
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
        Connection
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
          <option value={implicit}>TLS on port {implicit}</option>
          <option value={startTls}>STARTTLS on port {startTls}</option>
        </select>
      </label>
      <label class="grid gap-1 text-sm">
        Username
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

function connectionError(code?: string): string {
  switch (code) {
    case 'address_unverified':
      return 'Connect a verified address associated with your Macro account.';
    case 'provider_conflict':
      return 'This address already has an inbox connection.';
    case 'connection_changed':
      return 'This inbox changed while you were connecting. Close this window and open it again.';
    case 'disabled':
      return 'New IMAP connections are temporarily unavailable.';
    case 'credentials_rejected':
      return 'Sign-in was rejected. Check your username and app password.';
    case 'dns_unavailable':
      return 'Could not find the mail server. Check the server name and try again.';
    case 'tcp_unavailable':
      return 'Could not reach the mail server. Check its port and try again.';
    case 'tls_unavailable':
      return 'Could not establish a secure connection. Check the server name and TLS settings.';
    case 'connection_timed_out':
      return 'The mail server took too long to respond. Try again in a few minutes.';
    case 'invalid':
    case 'forbidden':
      return 'Check the server names, ports and usernames, then confirm the servers.';
    case 'throttled':
      return 'Too many attempts. Wait a few minutes before trying again.';
    default:
      return 'Could not verify the connection. Check the server settings and try again.';
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
  const [error, setError] = createSignal('');
  const [discovery, setDiscovery] = createSignal<Discovery>();
  const [imap, setImap] = createSignal(blankEndpoint(email(), 993));
  const [smtp, setSmtp] = createSignal(blankEndpoint(email(), 465));
  const [separatePassword, setSeparatePassword] = createSignal(false);
  const [confirmed, setConfirmed] = createSignal(false);
  const [manual, setManual] = createSignal(false);
  let passwordInput: HTMLInputElement | undefined;
  let smtpPasswordInput: HTMLInputElement | undefined;
  let controller: AbortController | undefined;
  let requestId = crypto.randomUUID();

  function clearPasswords() {
    if (passwordInput) passwordInput.value = '';
    if (smtpPasswordInput) smtpPasswordInput.value = '';
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
    setError('');
    requestId = crypto.randomUUID();
  }

  async function discover(parent: Span) {
    if (busy() || !isCurrentQueryAccount(viewer)) return;
    const address = email().trim();
    setEmail(address);
    setBusy(true);
    setError('');
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
      !passwordInput
    )
      return;
    setBusy(true);
    setError('');
    const attempt = new AbortController();
    controller = attempt;
    try {
      const result = await imapConnect(
        {
          requestId,
          linkId: props.linkId,
          email: email().trim(),
          imap: { endpoint: imap(), password: passwordInput.value },
          smtp: {
            endpoint: smtp(),
            password: separatePassword()
              ? (smtpPasswordInput?.value ?? '')
              : passwordInput.value,
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
  const canUsePassword = () => steer() !== 'outlook' && steer() !== 'none';
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
      class={isMobile() ? 'py-(--safe-top)' : 'w-118'}
    >
      <Panel
        depth={2}
        class={isMobile() ? 'h-full' : 'max-h-[85dvh] rounded-xl'}
      >
        <Panel.Header class="px-5">
          <Dialog.Title class="font-semibold">
            {props.linkId ? 'Reconnect inbox' : 'Connect email'}
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
                Email address
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
                    Change address
                  </Button>
                </Show>
                <Show when={oauthProvider()}>
                  {(provider) => (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => props.onResult(provider().code)}
                    >
                      Continue with {provider().name}
                    </Button>
                  )}
                </Show>
                <Show when={steer() === 'none'}>
                  <p class="text-sm text-ink-muted">
                    {discovery()?.provider} does not provide a mailbox Macro can
                    connect to directly.
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
                      Server settings
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
                      I trust {imap().host || 'the incoming server'}
                      {imap().host !== smtp().host
                        ? ` and ${smtp().host || 'the outgoing server'}`
                        : ''}{' '}
                      with my mail credentials.
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
                        Create an app password
                      </a>
                    )}
                  </Show>
                  <label class="grid gap-1 text-sm">
                    Password or app password
                    <Input
                      class="ph-no-capture"
                      type="password"
                      required
                      disabled={!confirmed()}
                      autocomplete="off"
                      ref={passwordInput}
                    />
                  </label>
                  <label class="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={separatePassword()}
                      onChange={(event) =>
                        setSeparatePassword(event.currentTarget.checked)
                      }
                    />
                    Use a separate outgoing password
                  </label>
                  <Show when={separatePassword()}>
                    <label class="grid gap-1 text-sm">
                      Outgoing password
                      <Input
                        class="ph-no-capture"
                        type="password"
                        required
                        disabled={!confirmed()}
                        autocomplete="off"
                        ref={smtpPasswordInput}
                      />
                    </label>
                  </Show>
                </Show>
              </Show>
              <Show when={error()}>
                <p role="alert" class="text-sm text-failure">
                  {error()}
                </p>
              </Show>
            </fieldset>
            <div class="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => props.onOpenChange(false)}
              >
                Cancel
              </Button>
              <Show when={phase() === 'address' || canUsePassword()}>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busy() || (phase() === 'servers' && !confirmed())}
                >
                  {phase() === 'address'
                    ? busy()
                      ? 'Finding settings…'
                      : 'Find settings'
                    : busy()
                      ? 'Checking connection…'
                      : 'Connect inbox'}
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
