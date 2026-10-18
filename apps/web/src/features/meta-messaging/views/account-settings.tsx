import { ConnectionMore } from '@app/features/settings/connections/connection-more';
import {
  type DisconnectConfirm,
  DisconnectConfirmDialog,
} from '@app/features/settings/connections/disconnect-confirm';
import { StatusDot } from '@app/features/settings/integration-ui';
import {
  IntegrationRow,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '@app/features/settings/primitives';
import { useUserId } from '@core/context/user';
import CaretRightIcon from '@phosphor/caret-right.svg';
import InstagramIcon from '@phosphor/instagram-logo.svg';
import WhatsAppIcon from '@phosphor/whatsapp-logo.svg';
import { queryReadyGate } from '@queries/gate';
import {
  useMetaActions,
  useMetaConfiguration,
  useMetaConnections,
} from '@queries/meta-messaging';
import { useCurrentTeamQuery, useIsTeamAdmin } from '@queries/team/teams';
import type { MetaConnection } from '@service-storage/generated/schemas/metaConnection';
import type { MetaProvider } from '@service-storage/generated/schemas/metaProvider';
import { Button, TextField } from '@ui';
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

type MessagingSettingsProps = {
  provider?: MetaProvider;
  onSelectProvider: (provider: MetaProvider) => void;
  onBack: () => void;
};

export function BusinessMessagingSettings(props: MessagingSettingsProps) {
  return (
    <Suspense
      fallback={
        <p class="px-4 text-sm text-ink-muted">Loading messaging accounts…</p>
      }
    >
      <Accounts {...props} />
    </Suspense>
  );
}

function Accounts(props: MessagingSettingsProps) {
  const team = useCurrentTeamQuery();
  const isAdmin = useIsTeamAdmin();
  const userId = useUserId();
  const canManage = (account: MetaConnection) =>
    isAdmin() || account.user_id === userId();
  const [disconnectRequest, setDisconnectRequest] =
    createSignal<DisconnectConfirm | null>(null);
  const configuration = useMetaConfiguration();
  const teamId = () => (queryReadyGate(team) ? (team.data?.team.id ?? '') : '');
  const connections = useMetaConnections(teamId, () => !!teamId());
  const actions = useMetaActions();
  const [working, setWorking] = createSignal(false);
  const [notice, setNotice] = createSignal('');
  const [error, setError] = createSignal('');
  const config = () =>
    queryReadyGate(configuration) ? configuration.data : undefined;
  const rows = () => (queryReadyGate(connections) ? connections.data : []);
  const available = (provider: MetaProvider) =>
    provider === 'whatsapp'
      ? !!config()?.whatsapp_configuration_id ||
        !!config()?.whatsapp_platform_configuration_id
      : !!config()?.instagram_app_id;

  let instagram: ReturnType<typeof instagramLoginWindow> | undefined;
  let active = true;
  onCleanup(() => {
    active = false;
    instagram?.close();
  });

  async function connect(
    provider: MetaProvider,
    existing?: MetaConnection,
    mode: 'coexistence' | 'platform' = existing?.whatsapp_mode ?? 'coexistence'
  ) {
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
        const configurationId =
          mode === 'platform'
            ? c.whatsapp_platform_configuration_id
            : c.whatsapp_configuration_id;
        if (!c.whatsapp_app_id || !configurationId)
          throw new Error('configuration_required');
        const result = await whatsappSignup({
          appId: c.whatsapp_app_id,
          configurationId,
          mode,
          version: c.graph_version,
          state: begin.state,
        });
        await actions.complete.mutateAsync({
          ...result,
          state: begin.state,
          whatsapp_mode: mode,
        });
      } else {
        if (!active) return;
        if (!instagram || !begin.browser_transaction)
          throw new Error('configuration_required');
        setNotice(
          'Finish connecting in the Instagram window. Keep Settings open.'
        );
        const result = await instagram.authorize(begin);
        if (!active) return;
        await actions.complete.mutateAsync({
          ...result,
          state: begin.state,
          browser_transaction: begin.browser_transaction,
        });
      }
    } catch (e) {
      setError(
        e instanceof InstagramLoginError
          ? e.message
          : messagingError(
              e instanceof Error ? e.message : undefined,
              provider,
              'connection'
            )
      );
    } finally {
      instagram?.close();
      instagram = undefined;
      setNotice('');
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

  const providerViews = () => (
    <>
      <For
        each={
          props.provider
            ? [props.provider]
            : (['whatsapp', 'instagram'] as const)
        }
      >
        {(provider) => (
          <ProviderAccounts
            provider={provider}
            detail={!!props.provider}
            onBack={props.onBack}
            accounts={rows().filter(
              (connection) => connection.provider === provider
            )}
            isMember={!!teamId()}
            canManage={canManage}
            loading={
              team.isPending ||
              configuration.isPending ||
              (!!teamId() && connections.isPending)
            }
            unavailable={
              team.isError || configuration.isError || connections.isError
            }
            canConnect={available(provider)}
            coexistenceAvailable={!!config()?.whatsapp_configuration_id}
            platformAvailable={!!config()?.whatsapp_platform_configuration_id}
            onRegister={actions.register}
            testAvailable={
              provider === 'whatsapp' &&
              !!config()?.whatsapp_developer_available
            }
            working={working()}
            notice={notice()}
            error={error()}
            onOpen={() => props.onSelectProvider(provider)}
            onConnect={(existing, mode) =>
              void connect(provider, existing, mode)
            }
            onConnectTest={() => void connectTestAccount()}
            onDisconnect={(connection) =>
              setDisconnectRequest({
                title: `Disconnect ${connection.display_name}?`,
                body: 'New customer messages and replies will stop. Existing channels keep their content and permissions.',
                onConfirm: () => void disconnect(connection),
              })
            }
            onRefresh={() => {
              void team.refetch();
              void connections.refetch();
              void configuration.refetch();
            }}
          />
        )}
      </For>
      <Show when={team.isSuccess && !teamId()}>
        <p class="px-4 pb-4 text-sm text-ink-muted">
          Join a team to connect messaging accounts.
        </p>
      </Show>
    </>
  );
  return (
    <>
      <Show
        when={props.provider}
        fallback={<SettingsCard>{providerViews()}</SettingsCard>}
      >
        {providerViews()}
      </Show>
      <DisconnectConfirmDialog
        request={disconnectRequest()}
        onClose={() => setDisconnectRequest(null)}
      />
    </>
  );
}

function ProviderAccounts(props: {
  provider: MetaProvider;
  detail: boolean;
  onBack: () => void;
  accounts: MetaConnection[];
  isMember: boolean;
  canManage: (connection: MetaConnection) => boolean;
  loading: boolean;
  unavailable: boolean;
  canConnect: boolean;
  coexistenceAvailable: boolean;
  platformAvailable: boolean;
  onRegister: (id: string, pin?: string) => Promise<MetaConnection>;
  testAvailable: boolean;
  working: boolean;
  notice: string;
  error: string;
  onOpen: () => void;
  onConnect: (
    existing?: MetaConnection,
    mode?: 'coexistence' | 'platform'
  ) => void;
  onConnectTest: () => void;
  onDisconnect: (connection: MetaConnection) => void;
  onRefresh: () => void;
}) {
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
    if (active().length === 1) return active()[0].display_name.trim();
    if (active().length > 1) return `${active().length} accounts`;
    return props.provider === 'whatsapp'
      ? 'Business messages in Macro.'
      : 'Direct messages in Macro.';
  };

  const connectActions = () => (
    <div class="flex flex-wrap items-center gap-2">
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
      <Show when={props.provider === 'whatsapp' && props.platformAvailable}>
        <Button
          variant="outline"
          size="sm"
          disabled={props.working}
          onClick={() => props.onConnect(undefined, 'platform')}
        >
          Connect Platform number
        </Button>
      </Show>
      <Show
        when={
          props.canConnect &&
          (props.provider !== 'whatsapp' || props.coexistenceAvailable)
        }
      >
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
    </div>
  );
  return (
    <Show
      when={props.detail}
      fallback={
        <IntegrationRow
          icon={
            props.provider === 'whatsapp' ? <WhatsAppIcon /> : <InstagramIcon />
          }
          title={title()}
          description={description()}
          status={
            <Show when={needsAttention()}>
              <StatusDot state="attention" label="Needs attention" />
            </Show>
          }
        >
          <Button
            variant="ghost"
            size="sm"
            disabled={!props.isMember || props.loading}
            class="min-h-11 gap-2"
            aria-label={`${props.accounts.length ? 'Manage' : 'Connect'} ${title()}`}
            onClick={props.onOpen}
          >
            {props.accounts.length ? 'Manage' : 'Connect'}
            <CaretRightIcon class="size-4 text-ink-muted" />
          </Button>
        </IntegrationRow>
      }
    >
      <SettingsPage
        title={title()}
        icon={
          props.provider === 'whatsapp' ? <WhatsAppIcon /> : <InstagramIcon />
        }
        description={
          props.provider === 'instagram'
            ? 'Receive Instagram DMs and reply to customers from Macro.'
            : 'Manage customer conversations from WhatsApp in Macro.'
        }
        onBack={props.onBack}
        backLabel="Integrations"
        actions={active().length ? connectActions() : undefined}
      >
        <Show when={props.unavailable}>
          <SettingsSection title="Accounts couldn’t load">
            <p role="alert" class="text-sm text-ink-muted">
              Try loading your connected accounts again.
            </p>
            <Button variant="outline" size="sm" onClick={props.onRefresh}>
              Retry
            </Button>
          </SettingsSection>
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
        <AccountRows
          accounts={active()}
          canManage={props.canManage}
          onRegister={props.onRegister}
          working={props.working}
          onConnect={props.onConnect}
          onDisconnect={props.onDisconnect}
        />
        <Show when={!active().length && !props.unavailable}>
          <SettingsSection
            title="Connect an account"
            description={
              props.provider === 'instagram'
                ? 'Connect a Business or Creator account to bring your customer messages into Macro.'
                : props.testAvailable && !props.canConnect
                  ? 'Use Meta’s test number to try messaging.'
                  : 'Connect your WhatsApp Business app or a Cloud API Platform number.'
            }
          >
            <div class="pt-3">{connectActions()}</div>
            <Show when={!props.canConnect && !props.testAvailable}>
              <p class="text-sm text-ink-muted">
                Your Macro administrator needs to enable account connections.
              </p>
            </Show>
          </SettingsSection>
        </Show>
        <Show when={disconnected().length}>
          <SettingsSection title="Previously connected">
            <SettingsCard>
              <For each={disconnected()}>
                {(account) => (
                  <SettingsRow label={account.display_name.trim()} muted>
                    <Show when={props.canManage(account)}>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={props.working}
                        onClick={() => props.onConnect(account)}
                      >
                        Reconnect
                      </Button>
                    </Show>
                  </SettingsRow>
                )}
              </For>
            </SettingsCard>
          </SettingsSection>
        </Show>
        <Show when={props.provider === 'whatsapp' && props.canConnect}>
          <p class="text-xs leading-relaxed text-ink-muted">
            Meta’s setup may unlink companion devices or change phone-app
            features. Cloud API messaging rates apply.
          </p>
        </Show>
      </SettingsPage>
    </Show>
  );
}

function AccountRows(props: {
  accounts: MetaConnection[];
  canManage: (connection: MetaConnection) => boolean;
  onRegister: (id: string, pin?: string) => Promise<MetaConnection>;
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
              canManage={props.canManage(account())}
              onRegister={props.onRegister}
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
  canManage: boolean;
  onRegister: (id: string, pin?: string) => Promise<MetaConnection>;
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
    <div data-messaging-account={props.connection.id}>
      <SettingsSection
        title={
          <span class="break-words">
            {props.connection.display_name.trim()}
          </span>
        }
        actions={
          <div class="flex items-center gap-3">
            <span class="flex items-center gap-2 text-xs text-ink-muted">
              <StatusDot
                state={
                  props.connection.status === 'connected'
                    ? 'connected'
                    : ['revoked', 'error'].includes(props.connection.status)
                      ? 'attention'
                      : 'disconnected'
                }
                label={status()}
              />
              {status()}
            </span>
            <Show when={props.canManage}>
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
            </Show>
          </div>
        }
      >
        <div>
          <SettingsCard>
            <Show
              when={
                props.canManage && props.connection.status !== 'disconnected'
              }
            >
              <SettingsRow
                stackOnNarrow
                label="Conversation history"
                description="Import past customer conversations into Macro."
              >
                <AccountHistoryImport connection={props.connection} />
              </SettingsRow>
            </Show>
          </SettingsCard>
          <Show
            when={
              props.canManage &&
              props.connection.whatsapp_mode === 'platform' &&
              props.connection.registration_status !== 'registered' &&
              !['disconnected', 'revoked'].includes(props.connection.status)
            }
          >
            <PhoneRegistration
              connection={props.connection}
              onRegister={props.onRegister}
            />
          </Show>
          <Show
            when={accountHealthMessage(
              props.connection.status,
              props.connection.health_error,
              props.connection.provider
            )}
          >
            {(message) => (
              <p class="mt-2 text-sm text-ink-muted">{message()}</p>
            )}
          </Show>
        </div>
      </SettingsSection>
    </div>
  );
}

function PhoneRegistration(props: {
  connection: MetaConnection;
  onRegister: (id: string, pin?: string) => Promise<MetaConnection>;
}) {
  const [pin, setPin] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const needsPin = () => props.connection.registration_status === 'required';
  async function submit() {
    if (pending()) return;
    const secret = needsPin() ? pin() : undefined;
    setPin('');
    setPending(true);
    setError('');
    try {
      await props.onRegister(props.connection.id, secret);
    } catch {
      setError(
        'Registration could not be confirmed. Your connection is saved; check its status before trying again.'
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div class="mt-3 space-y-2">
      <Show when={needsPin()}>
        <TextField value={pin()} onChange={setPin}>
          <TextField.Label>WhatsApp two-step verification PIN</TextField.Label>
          <TextField.Input
            type="password"
            inputMode="numeric"
            autocomplete="off"
            maxLength={6}
            pattern="[0-9]{6}"
            disabled={pending()}
          />
        </TextField>
      </Show>
      <Button
        size="sm"
        disabled={pending() || (needsPin() && !/^[0-9]{6}$/.test(pin()))}
        onClick={() => void submit()}
      >
        {pending()
          ? 'Checking…'
          : needsPin()
            ? 'Register number'
            : 'Check registration'}
      </Button>
      <Show when={error()}>
        <p role="alert" class="text-sm text-failure">
          {error()}
        </p>
      </Show>
    </div>
  );
}
