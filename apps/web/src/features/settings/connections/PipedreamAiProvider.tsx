import { toast } from '@core/component/Toast/Toast';
import { createPipedreamCatalogConnect } from '@core/pipedream/catalog';
import { connectSlugForPipedreamApp } from '@core/pipedream/slugs';
import {
  useDeletePipedreamConnectionMutation,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import { createSignal, type JSX, Show, Suspense } from 'solid-js';
import { match } from 'ts-pattern';
import { type ConnectionState, StatusDot } from '../integration-ui';
import {
  IntegrationRow,
  SettingsCard,
  SettingsPage,
  SettingsSection,
} from '../primitives';
import { AiGrantActions } from './ai-grant-actions';
import { capabilityFacts } from './capability-row';
import {
  type DisconnectConfirm,
  DisconnectConfirmDialog,
} from './disconnect-confirm';
import {
  type CapabilityStatus,
  type ConnectionsModel,
  CURATED_AI,
  type CuratedAiProvider,
  capabilitiesFor,
} from './model';
import { useNativeMcpActions } from './native-actions';
import { providerIcon } from './provider-meta';
import { SlackChannelImportCard } from './slack-channel-import/SlackChannelImportCard';
import { useConnectionsView } from './view-state';

const COPY: Record<
  CuratedAiProvider,
  { title: string; name: string; outcome: string }
> = {
  github: {
    title: 'GitHub',
    name: 'GitHub',
    outcome: CURATED_AI.github.outcome,
  },
  linear: {
    title: 'Linear',
    name: 'Linear',
    outcome: CURATED_AI.linear.outcome,
  },
  notion: {
    title: 'Notion',
    name: 'Notion',
    outcome: CURATED_AI.notion.outcome,
  },
  slack: {
    title: 'Slack',
    name: 'Slack',
    outcome: CURATED_AI.slack.outcome,
  },
};

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

export function PipedreamAiProvider(props: {
  model: ConnectionsModel;
  provider: CuratedAiProvider;
}) {
  const view = useConnectionsView();
  const copy = COPY[props.provider];
  const row = () =>
    capabilitiesFor(props.model, props.provider).find(
      (item) => item.kind === 'ai'
    );
  const status = () => row()?.status ?? 'not-connected';
  const indicator = () => statusIndicator(status());
  const aiFacts = () => {
    const cap = row();
    return cap ? capabilityFacts(cap) : 'Powered by Pipedream';
  };
  const update = useUpdatePipedreamConnectionMutation();
  const remove = useDeletePipedreamConnectionMutation();
  const native = useNativeMcpActions();
  const { connect, busy } = createPipedreamCatalogConnect({
    entry: () => ({
      app_slug: connectSlugForPipedreamApp(props.provider),
      display_name: copy.name,
    }),
    onConnected: () => toast.success(`${copy.name} connected`),
  });

  const [disconnect, setDisconnect] = createSignal<DisconnectConfirm | null>(
    null
  );

  const setEnabled = (enabled: boolean) => {
    const cap = row();
    if (!cap) return;
    if (cap.mechanism === 'native-mcp') {
      const url = cap.sourceUrl;
      if (!url) return;
      native.update.mutate(
        { url, enabled },
        { onError: () => toast.failure('Failed to update connector') }
      );
      return;
    }
    update.mutate(
      { app_slug: row()?.appSlug ?? props.provider, enabled },
      { onError: () => toast.failure('Failed to update connector') }
    );
  };

  const askDisconnect = () => {
    const cap = row();
    if (!cap) return;
    if (cap.mechanism === 'native-mcp') {
      const url = cap.sourceUrl;
      if (!url) return;
      setDisconnect({
        title: 'Disconnect from Macro',
        body: `Disconnect ${copy.name}?`,
        onConfirm: () =>
          native.remove.mutate(
            { url },
            {
              onSuccess: () =>
                toast.success(`Disconnected ${copy.name} from Macro`),
              onError: () => toast.failure('Failed to disconnect'),
            }
          ),
      });
      return;
    }
    setDisconnect({
      title: 'Disconnect from Macro',
      body: `Disconnect ${copy.name}?`,
      onConfirm: () =>
        remove.mutate(
          { app_slug: row()?.appSlug ?? props.provider },
          {
            onSuccess: () =>
              toast.success(`Disconnected ${copy.name} from Macro`),
            onError: () => toast.failure('Failed to disconnect'),
          }
        ),
    });
  };

  const reconnect = () => {
    const cap = row();
    if (!cap) return;
    if (cap.mechanism === 'native-mcp') {
      const url = cap.sourceUrl;
      if (!url) return;
      native.startAuth(url, cap.account || copy.name);
      return;
    }
    void connect();
  };

  const actions = (): JSX.Element => (
    <AiGrantActions
      status={status()}
      onConnect={() => void connect()}
      onReconnect={reconnect}
      onEnable={() => setEnabled(true)}
      onDisable={() => setEnabled(false)}
      onDisconnect={askDisconnect}
      connectBusy={busy()}
      authPending={native.authorize.isPending}
      updatePending={native.update.isPending || update.isPending}
      removePending={native.remove.isPending || remove.isPending}
    />
  );

  return (
    <SettingsPage
      title={copy.title}
      icon={providerIcon(props.provider)}
      description={copy.outcome}
      onBack={view.closeProvider}
      backLabel="Connections"
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
            facts={aiFacts()}
            muted={status() === 'off'}
          >
            {actions()}
          </IntegrationRow>
        </SettingsCard>
      </SettingsSection>
      <Show
        when={
          props.provider === 'slack' &&
          row()?.mechanism === 'pipedream' &&
          row()?.status === 'connected'
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
