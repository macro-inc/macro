import { toast } from '@core/component/Toast/Toast';
import { createPipedreamCatalogConnect } from '@core/pipedream/catalog';
import {
  useDeletePipedreamConnectionMutation,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import { createSignal, type JSX } from 'solid-js';
import { SettingsCard, SettingsPage, SettingsSection } from '../primitives';
import { AiGrantActions } from './ai-grant-actions';
import { CapabilityRow, capabilityFacts } from './capability-row';
import {
  type DisconnectConfirm,
  DisconnectConfirmDialog,
} from './disconnect-confirm';
import {
  type ConnectionsModel,
  CURATED_AI,
  type CuratedAiProvider,
  capabilitiesFor,
} from './model';
import { useNativeMcpActions } from './native-actions';
import { providerIcon } from './provider-meta';
import { closeConnectionsProvider } from './view-state';

const COPY: Record<
  Exclude<CuratedAiProvider, 'github'>,
  { title: string; name: string; outcome: string }
> = {
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

export function PipedreamAiProvider(props: {
  model: ConnectionsModel;
  provider: Exclude<CuratedAiProvider, 'github'>;
}) {
  const copy = COPY[props.provider];
  const row = () =>
    capabilitiesFor(props.model, props.provider).find(
      (item) => item.kind === 'ai'
    );
  const aiFacts = () => {
    const cap = row();
    return cap ? capabilityFacts(cap) : 'Powered by Pipedream';
  };
  const update = useUpdatePipedreamConnectionMutation();
  const remove = useDeletePipedreamConnectionMutation();
  const native = useNativeMcpActions();
  const { connect, busy } = createPipedreamCatalogConnect({
    entry: () => ({
      app_slug: props.provider,
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
      { app_slug: props.provider, enabled },
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
          { app_slug: props.provider },
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
      status={row()?.status ?? 'not-connected'}
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
      onBack={closeConnectionsProvider}
    >
      <SettingsSection title="Your Connections">
        <SettingsCard>
          <CapabilityRow
            title={copy.title}
            outcome={copy.outcome}
            facts={aiFacts()}
            muted={row()?.status === 'off'}
          >
            {actions()}
          </CapabilityRow>
        </SettingsCard>
      </SettingsSection>
      <DisconnectConfirmDialog
        request={disconnect()}
        onClose={() => setDisconnect(null)}
      />
    </SettingsPage>
  );
}
