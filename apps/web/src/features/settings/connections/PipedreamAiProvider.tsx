import { toast } from '@core/component/Toast/Toast';
import { createPipedreamCatalogConnect } from '@core/pipedream/catalog';
import {
  useDeletePipedreamConnectionMutation,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import { createSignal, type JSX } from 'solid-js';
import { ConnectAction } from '../integration-ui';
import { SettingsCard, SettingsPage, SettingsSection } from '../primitives';
import { CapabilityRow, capabilityFacts } from './capability-row';
import {
  type ConnectionMenuItem,
  ConnectionRowActions,
} from './connection-more';
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
  { title: string; name: string; page: string; outcome: string; later: string }
> = {
  linear: {
    title: 'Linear',
    name: 'Linear',
    page: 'Bring your issues into your unified workspace.',
    outcome: CURATED_AI.linear.outcome,
    later:
      'Macro can also import recent issues as tasks later. That is not a separate connection.',
  },
  notion: {
    title: 'Notion',
    name: 'Notion',
    page: 'Bring your docs and wikis into your unified workspace.',
    outcome: CURATED_AI.notion.outcome,
    later:
      'Macro can also import pages as docs later. That is not continuous sync, and it is not a separate connection.',
  },
  slack: {
    title: 'Slack',
    name: 'Slack',
    page: 'Bring your conversations into your unified workspace.',
    outcome: CURATED_AI.slack.outcome,
    later:
      'Macro can also create channels from Slack later. That is not a second connection.',
  },
};

export function PipedreamAiProvider(props: {
  model: ConnectionsModel;
  provider: Exclude<CuratedAiProvider, 'github'>;
}) {
  const copy = COPY[props.provider];
  const row = () =>
    capabilitiesFor(props.model, props.provider).find(
      (item) => item.id === `${props.provider}-ai`
    );
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

  const reconnectItem = (): ConnectionMenuItem => ({
    label: 'Reconnect',
    onSelect: reconnect,
    disabled: native.authorize.isPending || busy(),
  });

  const disconnectItem = (): ConnectionMenuItem => ({
    label: 'Disconnect',
    danger: true,
    onSelect: askDisconnect,
    disabled: native.remove.isPending || remove.isPending,
  });

  const actions = (): JSX.Element => {
    const status = row()?.status ?? 'not-connected';
    switch (status) {
      case 'not-connected':
        return (
          <ConnectionRowActions
            primary={
              <ConnectAction
                label="Connect"
                onClick={() => void connect()}
                loading={busy()}
              />
            }
            items={[]}
          />
        );
      case 'action-required':
        return (
          <ConnectionRowActions
            primary={
              <ConnectAction
                label="Reconnect"
                onClick={reconnect}
                disabled={native.authorize.isPending || busy()}
              />
            }
            items={[reconnectItem(), disconnectItem()]}
          />
        );
      case 'connected':
        return (
          <ConnectionRowActions
            items={[
              {
                label: 'Turn off',
                onSelect: () => setEnabled(false),
                disabled: native.update.isPending || update.isPending,
              },
              reconnectItem(),
              disconnectItem(),
            ]}
          />
        );
      case 'off':
        return (
          <ConnectionRowActions
            primary={
              <ConnectAction
                label="Turn on"
                variant="neutral"
                onClick={() => setEnabled(true)}
                disabled={native.update.isPending || update.isPending}
              />
            }
            items={[reconnectItem(), disconnectItem()]}
          />
        );
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
  };

  return (
    <SettingsPage
      title={copy.title}
      description={copy.page}
      icon={providerIcon(props.provider)}
      onBack={closeConnectionsProvider}
    >
      <SettingsSection title="Your Connections">
        <SettingsCard>
          <CapabilityRow
            title={copy.title}
            outcome={copy.outcome}
            facts={
              row()
                ? capabilityFacts(row()!)
                : 'Personal · Powered by Pipedream'
            }
            status={row()?.status}
          >
            {actions()}
          </CapabilityRow>
        </SettingsCard>
        <p class="text-xs text-ink-extra-muted">{copy.later}</p>
      </SettingsSection>
      <DisconnectConfirmDialog
        request={disconnect()}
        onClose={() => setDisconnect(null)}
      />
    </SettingsPage>
  );
}
