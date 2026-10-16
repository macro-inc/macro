import { ConnectionMore } from '@app/features/settings/connections/connection-more';
import {
  IntegrationRow,
  SettingsCard,
} from '@app/features/settings/primitives';
import { displayAuthorName } from '@core/messages/author-name';
import InstagramIcon from '@phosphor/instagram-logo.svg';
import WhatsAppIcon from '@phosphor/whatsapp-logo.svg';
import {
  useMetaActions,
  useMetaConfiguration,
  useMetaConnections,
} from '@queries/meta-messaging';
import { useCurrentTeamQuery, useIsTeamAdmin } from '@queries/team/teams';
import type { MetaConnection } from '@service-storage/generated/schemas/metaConnection';
import type { MetaProvider } from '@service-storage/generated/schemas/metaProvider';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, For, onCleanup, Show, Suspense } from 'solid-js';
import {
  accountHealthMessage,
  disconnectMessage,
} from '../core/account-health';
import { messagingError } from '../core/delivery';
import { whatsappSignup } from '../queries/facebook-signup';
import {
  InstagramLoginError,
  instagramLoginWindow,
} from '../queries/instagram-login';
import { AccountHistoryImport } from './history-import';

export function BusinessMessagingSettings() {
  return (
    <Suspense
      fallback={
        <p class="px-4 text-sm text-ink-muted">Loading messaging accounts…</p>
      }
    >
      <Accounts />
    </Suspense>
  );
}

function Accounts() {
  const team = useCurrentTeamQuery();
  const isAdmin = useIsTeamAdmin();
  const configuration = useMetaConfiguration();
  const teamId = () => (team.isSuccess ? (team.data?.team.id ?? '') : '');
  const connections = useMetaConnections(teamId, isAdmin);
  const actions = useMetaActions();
  const [working, setWorking] = createSignal(false);
  const [notice, setNotice] = createSignal('');
  const [error, setError] = createSignal('');
  const config = () =>
    configuration.isSuccess ? configuration.data : undefined;
  const rows = () => (connections.isSuccess ? connections.data : []);
  const available = (provider: MetaProvider) =>
    provider === 'whatsapp'
      ? !!config()?.whatsapp_configuration_id
      : !!config()?.instagram_app_id;

  let instagram: ReturnType<typeof instagramLoginWindow> | undefined;
  let active = true;
  onCleanup(() => {
    active = false;
    instagram?.close();
  });

  async function connect(provider: MetaProvider, existing?: MetaConnection) {
    if (working()) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      // Open synchronously with the click so popup blockers do not lose login.
      if (provider === 'instagram') instagram = instagramLoginWindow();
      if (provider === 'whatsapp' && existing?.developer_account) {
        await actions.developer.mutateAsync();
        return;
      }
      const begin = await actions.begin.mutateAsync({
        provider,
        reconnectId: existing?.id,
      });
      if (provider === 'whatsapp') {
        const c = begin.configuration;
        if (!c.whatsapp_app_id || !c.whatsapp_configuration_id)
          throw new Error('WhatsApp signup is not configured.');
        const result = await whatsappSignup({
          appId: c.whatsapp_app_id,
          configurationId: c.whatsapp_configuration_id,
          version: c.graph_version,
          state: begin.state,
        });
        await actions.complete.mutateAsync({ ...result, state: begin.state });
        setNotice('Connecting… This page updates automatically.');
      } else {
        if (!active) return;
        if (!instagram || !begin.browser_transaction)
          throw new Error('Instagram login is not configured.');
        setNotice(
          'Finish connecting in the Instagram window. Keep Settings open.'
        );
        const result = await instagram.authorize(begin);
        if (!active) return;
        try {
          await actions.complete.mutateAsync({
            ...result,
            state: begin.state,
            browser_transaction: begin.browser_transaction,
          });
        } catch {
          throw new InstagramLoginError(
            'Instagram login expired, your Macro account changed, or this Instagram account does not match the reconnect. Sign in with the original Macro account and start again from Settings.'
          );
        }
        setNotice('Connecting… This page updates automatically.');
      }
    } catch (e) {
      setError(
        e instanceof InstagramLoginError
          ? e.message
          : e instanceof Error && /cancel|closed/i.test(e.message)
            ? 'Connection canceled. You can try again whenever you’re ready.'
            : e instanceof Error &&
                /not configured|permission|reconnect|revoked|coexistence/i.test(
                  e.message
                )
              ? messagingError(e.message, provider)
              : 'We couldn’t connect this account. Try again, and make sure you approve messaging access in Meta.'
      );
    } finally {
      instagram?.close();
      instagram = undefined;
      setWorking(false);
    }
  }

  async function disconnect(connection: MetaConnection) {
    setError('');
    setNotice('');
    setWorking(true);
    try {
      const result = await actions.disconnect.mutateAsync(connection.id);
      setNotice(disconnectMessage(result));
    } catch {
      setError('Disconnect failed. Try again.');
    } finally {
      setWorking(false);
    }
  }

  async function connectTestAccount() {
    if (working()) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await actions.developer.mutateAsync();
    } catch {
      setError('Test connection failed. Check the Meta token and test number.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <SettingsCard>
      <For each={['whatsapp', 'instagram'] as const}>
        {(provider) => (
          <ProviderAccounts
            provider={provider}
            accounts={rows().filter(
              (connection) => connection.provider === provider
            )}
            teamName={team.isSuccess ? team.data?.team.name : undefined}
            canManage={!!teamId() && isAdmin()}
            loading={
              team.isPending ||
              configuration.isPending ||
              (isAdmin() && connections.isPending)
            }
            unavailable={
              team.isError || configuration.isError || connections.isError
            }
            canConnect={available(provider)}
            testAvailable={
              provider === 'whatsapp' &&
              !!config()?.whatsapp_developer_available
            }
            working={working()}
            notice={notice()}
            error={error()}
            onOpen={() => {
              setNotice('');
              setError('');
            }}
            onConnect={(existing) => void connect(provider, existing)}
            onConnectTest={() => void connectTestAccount()}
            onDisconnect={(connection) => void disconnect(connection)}
            onRefresh={() => {
              void team.refetch();
              void connections.refetch();
              void configuration.refetch();
            }}
          />
        )}
      </For>
      <Show when={team.isSuccess && (!teamId() || !isAdmin())}>
        <p class="px-4 pb-4 text-sm text-ink-muted">
          {teamId()
            ? 'A team admin can manage messaging accounts.'
            : 'Join a team to connect messaging accounts.'}
        </p>
      </Show>
    </SettingsCard>
  );
}

function ProviderAccounts(props: {
  provider: MetaProvider;
  accounts: MetaConnection[];
  teamName?: string;
  canManage: boolean;
  loading: boolean;
  unavailable: boolean;
  canConnect: boolean;
  testAvailable: boolean;
  working: boolean;
  notice: string;
  error: string;
  onOpen: () => void;
  onConnect: (existing?: MetaConnection) => void;
  onConnectTest: () => void;
  onDisconnect: (connection: MetaConnection) => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  const title = () =>
    props.provider === 'whatsapp' ? 'WhatsApp Business' : 'Instagram';
  const active = () =>
    props.accounts.filter((account) => account.status !== 'disconnected');
  const disconnected = () =>
    props.accounts.filter((account) => account.status === 'disconnected');
  const needsAttention = () =>
    active().some(
      (account) => account.status === 'error' || account.status === 'revoked'
    );
  const description = () => {
    if (props.loading) return 'Loading…';
    if (props.unavailable) return 'Couldn’t load accounts';
    if (active().length === 1)
      return displayAuthorName(active()[0].display_name);
    if (active().length > 1) return `${active().length} accounts`;
    return props.provider === 'whatsapp'
      ? 'Business messages in Macro.'
      : 'Direct messages in Macro.';
  };

  return (
    <>
      <IntegrationRow
        icon={
          props.provider === 'whatsapp' ? <WhatsAppIcon /> : <InstagramIcon />
        }
        title={title()}
        description={description()}
        status={
          <Show when={needsAttention()}>
            <span class="text-xs text-failure">Needs attention</span>
          </Show>
        }
      >
        <Button
          variant="ghost"
          size="sm"
          disabled={!props.canManage || props.loading}
          ref={trigger}
          aria-label={`${props.accounts.length ? 'Manage' : 'Connect'} ${title()}`}
          onClick={() => {
            props.onOpen();
            setOpen(true);
          }}
        >
          {props.accounts.length ? 'Manage' : 'Connect'}
        </Button>
      </IntegrationRow>
      <Show when={open()}>
        <Dialog
          open
          onOpenChange={setOpen}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger?.focus();
          }}
          position="center"
          visibleScrim
          class="w-[min(520px,calc(100vw-16px))]"
        >
          <Panel depth={2} class="rounded-xl text-ink">
            <Panel.Header class="px-5 py-3">
              <Dialog.Title class="text-sm font-semibold">
                {title()}
              </Dialog.Title>
            </Panel.Header>
            <Panel.Body class="space-y-4 p-5 max-h-[65vh] overflow-y-auto">
              <Dialog.Description class="text-sm text-ink-muted">
                Accounts for {props.teamName}. Invite teammates from each
                conversation.
              </Dialog.Description>
              <Show when={props.unavailable}>
                <p role="alert" class="text-sm text-ink-muted">
                  Accounts couldn’t load.{' '}
                  <button class="underline" onClick={props.onRefresh}>
                    Retry
                  </button>
                </p>
              </Show>
              <div class="divide-y divide-edge-muted">
                <AccountRows
                  accounts={active()}
                  working={props.working}
                  onConnect={props.onConnect}
                  onDisconnect={props.onDisconnect}
                />
              </div>
              <Show when={disconnected().length}>
                <details class="text-sm text-ink-muted">
                  <summary>
                    Disconnected accounts ({disconnected().length})
                  </summary>
                  <div class="mt-2 divide-y divide-edge-muted">
                    <AccountRows
                      accounts={disconnected()}
                      working={props.working}
                      onConnect={props.onConnect}
                      onDisconnect={props.onDisconnect}
                    />
                  </div>
                </details>
              </Show>
              <Show when={!active().length && !props.unavailable}>
                <p class="text-sm text-ink-muted">
                  {props.provider === 'instagram'
                    ? 'Connect a Business or Creator account to receive DMs in Macro.'
                    : props.testAvailable && !props.canConnect
                      ? 'Use Meta’s test number to try messaging.'
                      : 'Connect your WhatsApp Business app number to receive messages in Macro.'}
                </p>
              </Show>
              <Show when={props.provider === 'whatsapp' && props.canConnect}>
                <p class="text-xs text-ink-muted">
                  Meta’s setup may unlink companion devices or change phone-app
                  features. Cloud API messaging rates apply.
                </p>
              </Show>
              <Show
                when={
                  !props.canConnect &&
                  !props.testAvailable &&
                  !props.unavailable
                }
              >
                <p class="text-sm text-ink-muted">
                  Your Macro administrator needs to enable account connections.
                </p>
              </Show>
              <Show when={props.notice}>
                <p role="status" class="text-sm text-ink-muted">
                  {props.notice}
                </p>
              </Show>
              <Show when={props.error}>
                <p role="alert" class="text-sm text-failure">
                  {props.error}
                </p>
              </Show>
            </Panel.Body>
            <Panel.Footer class="justify-end gap-2 px-5 py-3">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Show
                when={
                  props.testAvailable &&
                  !active().some((account) => account.developer_account)
                }
              >
                <Button
                  variant="outline"
                  size="sm"
                  disabled={props.working}
                  onClick={props.onConnectTest}
                >
                  Connect test number
                </Button>
              </Show>
              <Show when={props.canConnect}>
                <Button
                  variant="strong"
                  size="sm"
                  disabled={props.working}
                  onClick={() => props.onConnect()}
                >
                  {props.working
                    ? 'Connecting…'
                    : active().length
                      ? 'Add account'
                      : 'Connect account'}
                </Button>
              </Show>
            </Panel.Footer>
          </Panel>
        </Dialog>
      </Show>
    </>
  );
}

function AccountRows(props: {
  accounts: MetaConnection[];
  working: boolean;
  onConnect: (connection: MetaConnection) => void;
  onDisconnect: (connection: MetaConnection) => void;
}) {
  return (
    <For each={props.accounts.map((account) => account.id)}>
      {(id) => (
        <Show when={props.accounts.find((account) => account.id === id)}>
          {(account) => (
            <AccountRow
              connection={account()}
              working={props.working}
              onReconnect={() => props.onConnect(account())}
              onDisconnect={() => props.onDisconnect(account())}
            />
          )}
        </Show>
      )}
    </For>
  );
}

function AccountRow(props: {
  connection: MetaConnection;
  working: boolean;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  const status = () =>
    ({
      connecting: 'Connecting…',
      connected: 'Connected',
      disconnected: 'Disconnected',
      revoked: 'Reconnect needed',
      error: 'Needs attention',
    })[props.connection.status];
  return (
    <div class="py-3 first:pt-0 last:pb-0">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0">
          <p class="text-sm font-medium break-words">
            {displayAuthorName(props.connection.display_name)}
          </p>
          <p class="text-xs text-ink-muted">{status()}</p>
        </div>
        <div class="flex items-center gap-1">
          <Show when={props.connection.status !== 'disconnected'}>
            <AccountHistoryImport connection={props.connection} />
          </Show>
          <ConnectionMore
            items={[
              {
                label: 'Reconnect',
                icon: 'reconnect',
                disabled: props.working,
                onSelect: props.onReconnect,
              },
              ...(props.connection.status !== 'disconnected'
                ? [
                    {
                      label: 'Disconnect',
                      icon: 'disconnect' as const,
                      danger: true,
                      disabled: props.working,
                      onSelect: props.onDisconnect,
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </div>
      <Show
        when={accountHealthMessage(
          props.connection.status,
          props.connection.health_error,
          props.connection.provider
        )}
      >
        {(message) => <p class="mt-2 text-sm text-ink-muted">{message()}</p>}
      </Show>
    </div>
  );
}
