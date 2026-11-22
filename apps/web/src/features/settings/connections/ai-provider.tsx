import { toast } from '@core/component/Toast/Toast';
import { createConnectAction } from '@core/connectors/connect-action';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  appConnectorKey,
  useRemoveConnectorMutation,
  useUpdateConnectorMutation,
} from '@queries/connectors';
import { createSignal, Show, Suspense } from 'solid-js';
import { match } from 'ts-pattern';
import { type ConnectionState, StatusDot } from '../integration-ui';
import {
  IntegrationRow,
  SettingsCard,
  SettingsPage,
  SettingsSection,
} from '../primitives';
import { AiGrantActions } from './ai-grant-actions';
import {
  type DisconnectConfirm,
  DisconnectConfirmDialog,
} from './disconnect-confirm';
import {
  type CapabilityStatus,
  type ConnectionsModel,
  CURATED_AI,
  type CuratedAiProvider,
  capabilityFor,
} from './model';
import { providerIcon } from './provider-meta';
import { SlackChannelImportCard } from './slack-channel-import/SlackChannelImportCard';
import { useConnectionsView } from './view-state';

function statusIndicator(status: CapabilityStatus): {
  state: ConnectionState;
  label: string;
} {
  return match(status)
    .with('connected', () => ({
      state: 'connected' as const,
      label: 'Connected',
    }))
    .with('off', () => ({ state: 'disconnected' as const, label: 'Disabled' }))
    .with('action-required', () => ({
      state: 'attention' as const,
      label: 'Needs reconnecting',
    }))
    .with('not-connected', () => ({
      state: 'disconnected' as const,
      label: 'Not connected',
    }))
    .exhaustive();
}

/** One featured app's agent tools: its status and what can be done with it. */
export function AiProviderPage(props: {
  model: ConnectionsModel;
  provider: CuratedAiProvider;
}) {
  const view = useConnectionsView();
  const copy = CURATED_AI[props.provider];
  const key = appConnectorKey(props.provider);
  const row = () => capabilityFor(props.model, props.provider);
  const status = () => row()?.status ?? 'not-connected';
  const indicator = () => statusIndicator(status());
  // The connection's own name, when it says more than the app's.
  const facts = () => {
    const account = row()?.account;
    return account && account !== copy.title ? account : undefined;
  };
  const update = useUpdateConnectorMutation();
  const remove = useRemoveConnectorMutation();
  const { connect, busy } = createConnectAction({
    key: () => key,
    name: () => copy.title,
    onConnected: () => toast.success(`${copy.title} connected`),
  });

  const [disconnect, setDisconnect] = createSignal<DisconnectConfirm | null>(
    null
  );

  const setEnabled = (enabled: boolean) =>
    update.mutate(
      { key, enabled },
      { onError: () => toast.failure('Failed to update connector') }
    );

  const askDisconnect = () =>
    setDisconnect({
      title: 'Disconnect from Macro',
      // GitHub's connection is the account link, which other features use.
      body:
        props.provider === 'github'
          ? 'Disconnect GitHub? This unlinks your GitHub account from Macro, which pull request features also use.'
          : `Disconnect ${copy.title}?`,
      onConfirm: () =>
        remove.mutate(
          { key },
          {
            onSuccess: () =>
              toast.success(`Disconnected ${copy.title} from Macro`),
            onError: () => toast.failure('Failed to disconnect'),
          }
        ),
    });

  const startConnect = () => fireAndForget(connect(), 'connections-settings');

  return (
    <SettingsPage
      title={copy.title}
      icon={providerIcon(props.provider)}
      description={copy.outcome}
      onBack={view.closeProvider}
      backLabel="Integrations"
    >
      <SettingsSection title="Macro AI">
        <SettingsCard>
          <IntegrationRow
            icon={providerIcon(props.provider)}
            title={copy.title}
            status={
              <StatusDot state={indicator().state} label={indicator().label} />
            }
            description={indicator().label}
            facts={facts()}
            muted={status() === 'off'}
          >
            <AiGrantActions
              status={status()}
              held={row() !== undefined}
              onConnect={startConnect}
              onReconnect={startConnect}
              onEnable={() => setEnabled(true)}
              onDisable={() => setEnabled(false)}
              onDisconnect={askDisconnect}
              connectBusy={busy()}
              updatePending={update.isPending}
              removePending={remove.isPending}
            />
          </IntegrationRow>
        </SettingsCard>
      </SettingsSection>
      <Show
        when={
          props.provider === 'slack' &&
          row()?.status === 'connected' &&
          row()?.importAvailable
        }
      >
        <Suspense>
          <SlackChannelImportCard />
        </Suspense>
      </Show>
      <DisconnectConfirmDialog
        request={disconnect()}
        onClose={() => setDisconnect(null)}
      />
    </SettingsPage>
  );
}
