import { toast } from '@core/component/Toast/Toast';
import { SERVER_HOSTS } from '@core/constant/servers';
import { createPipedreamCatalogConnect } from '@core/pipedream/catalog';
import {
  githubLinkStartFailureMessage,
  useDeleteGithubLinkMutation,
  useInitGithubLinkMutation,
  useReauthenticateGithubMutation,
} from '@queries/auth';
import {
  useDeletePipedreamConnectionMutation,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import { createSignal, type JSX, Show } from 'solid-js';
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
  type CapabilityStatus,
  type ConnectionsModel,
  CURATED_AI,
  capabilitiesFor,
} from './model';
import { useNativeMcpActions } from './native-actions';
import { providerIcon } from './provider-meta';
import { closeConnectionsProvider } from './view-state';

export function GitHubProvider(props: { model: ConnectionsModel }) {
  const [disconnect, setDisconnect] = createSignal<DisconnectConfirm | null>(
    null
  );
  const rows = () => capabilitiesFor(props.model, 'github');
  const account = () => rows().find((row) => row.id === 'github-account');
  const team = () => rows().find((row) => row.id === 'github-team');
  const ai = () => rows().find((row) => row.id === 'github-ai');

  const initGithubLink = useInitGithubLinkMutation();
  const deleteGithubLink = useDeleteGithubLinkMutation();
  const reauthenticateGithub = useReauthenticateGithubMutation();
  const updatePipedream = useUpdatePipedreamConnectionMutation();
  const deletePipedream = useDeletePipedreamConnectionMutation();
  const native = useNativeMcpActions();
  const { connect: connectAi, busy: aiBusy } = createPipedreamCatalogConnect({
    entry: () => ({
      app_slug: 'github',
      display_name: 'GitHub',
    }),
    onConnected: () => toast.success('GitHub AI connected'),
  });

  const connectAccount = async () => {
    try {
      window.location.href = await initGithubLink.mutateAsync(
        window.location.href
      );
    } catch (error) {
      toast.failure(
        githubLinkStartFailureMessage(
          error,
          'Failed to start GitHub connect flow'
        )
      );
    }
  };

  const reconnectAccount = async () => {
    try {
      window.location.href = await reauthenticateGithub.mutateAsync(
        window.location.href
      );
    } catch (error) {
      toast.failure(
        githubLinkStartFailureMessage(
          error,
          'Failed to start GitHub reconnect flow'
        )
      );
    }
  };

  const disconnectAccount = async () => {
    try {
      await deleteGithubLink.mutateAsync();
    } catch {
      toast.failure('Failed to disconnect GitHub');
    }
  };

  const accountConnected = () => account()?.status === 'connected';

  const askDisconnectAccount = () =>
    setDisconnect({
      title: 'Disconnect from Macro',
      body: 'Disconnect GitHub? Pull requests will stop showing up in Macro.',
      onConfirm: () => void disconnectAccount(),
    });

  const accountDisconnectItem = (): ConnectionMenuItem => ({
    label: 'Disconnect',
    danger: true,
    onSelect: askDisconnectAccount,
    disabled: deleteGithubLink.isPending,
  });

  const accountReconnectItem = (): ConnectionMenuItem => ({
    label: 'Reconnect',
    onSelect: () => void reconnectAccount(),
    disabled: reauthenticateGithub.isPending,
  });

  const accountActions = (status: CapabilityStatus): JSX.Element => {
    switch (status) {
      case 'action-required':
        return (
          <ConnectionRowActions
            primary={
              <ConnectAction
                label="Reconnect"
                onClick={() => void reconnectAccount()}
                disabled={reauthenticateGithub.isPending}
              />
            }
            items={[accountReconnectItem(), accountDisconnectItem()]}
          />
        );
      case 'connected':
        return (
          <ConnectionRowActions
            items={[accountReconnectItem(), accountDisconnectItem()]}
          />
        );
      case 'off':
      case 'not-connected':
        return (
          <ConnectionRowActions
            primary={
              <ConnectAction
                label="Connect"
                onClick={() => void connectAccount()}
                disabled={initGithubLink.isPending}
              />
            }
            items={[]}
          />
        );
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
  };

  const setAiEnabled = (enabled: boolean) => {
    const cap = ai();
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
    updatePipedream.mutate(
      { app_slug: 'github', enabled },
      { onError: () => toast.failure('Failed to update connector') }
    );
  };

  const askDisconnectAi = () => {
    const cap = ai();
    if (!cap) return;
    if (cap.mechanism === 'native-mcp') {
      const url = cap.sourceUrl;
      if (!url) return;
      setDisconnect({
        title: 'Disconnect from Macro',
        body: 'Disconnect GitHub from Macro AI?',
        onConfirm: () =>
          native.remove.mutate(
            { url },
            {
              onSuccess: () =>
                toast.success('Disconnected GitHub AI from Macro'),
              onError: () => toast.failure('Failed to disconnect'),
            }
          ),
      });
      return;
    }
    setDisconnect({
      title: 'Disconnect from Macro',
      body: 'Disconnect GitHub from Macro AI?',
      onConfirm: () =>
        deletePipedream.mutate(
          { app_slug: 'github' },
          {
            onSuccess: () => toast.success('Disconnected GitHub AI from Macro'),
            onError: () => toast.failure('Failed to disconnect'),
          }
        ),
    });
  };

  const aiDisconnectItem = (): ConnectionMenuItem => ({
    label: 'Disconnect',
    danger: true,
    onSelect: askDisconnectAi,
    disabled: native.remove.isPending || deletePipedream.isPending,
  });

  const reconnectAi = () => {
    const cap = ai();
    if (!cap) return;
    if (cap.mechanism === 'native-mcp') {
      const url = cap.sourceUrl;
      if (!url) return;
      native.startAuth(url, cap.account);
      return;
    }
    void connectAi();
  };

  const aiReconnectItem = (): ConnectionMenuItem => ({
    label: 'Reconnect',
    onSelect: reconnectAi,
    disabled: native.authorize.isPending || aiBusy(),
  });

  const aiActions = (status: CapabilityStatus): JSX.Element => {
    switch (status) {
      case 'not-connected':
        return (
          <ConnectionRowActions
            primary={
              <ConnectAction
                label="Connect"
                onClick={() => void connectAi()}
                loading={aiBusy()}
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
                onClick={reconnectAi}
                disabled={native.authorize.isPending || aiBusy()}
              />
            }
            items={[aiReconnectItem(), aiDisconnectItem()]}
          />
        );
      case 'connected':
        return (
          <ConnectionRowActions
            items={[
              {
                label: 'Disable',
                onSelect: () => setAiEnabled(false),
                disabled: native.update.isPending || updatePipedream.isPending,
                icon: 'disable',
              },
              aiReconnectItem(),
              aiDisconnectItem(),
            ]}
          />
        );
      case 'off':
        return (
          <ConnectionRowActions
            primary={
              <ConnectAction
                label="Enable"
                variant="neutral"
                onClick={() => setAiEnabled(true)}
                disabled={native.update.isPending || updatePipedream.isPending}
              />
            }
            items={[aiReconnectItem(), aiDisconnectItem()]}
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
      title="GitHub"
      description="Connect Macro to your GitHub account and repositories."
      icon={providerIcon('github')}
      onBack={closeConnectionsProvider}
    >
      <SettingsSection title="Your Connections">
        <SettingsCard>
          <Show when={account()}>
            {(row) => (
              <CapabilityRow
                title={row().title}
                outcome={row().outcome}
                facts={capabilityFacts(row())}
              >
                {accountActions(row().status)}
              </CapabilityRow>
            )}
          </Show>

          <Show
            when={ai()}
            fallback={
              <CapabilityRow
                title={CURATED_AI.github.title}
                outcome={CURATED_AI.github.outcome}
                facts="Powered by Pipedream"
              >
                <ConnectionRowActions
                  primary={
                    <ConnectAction
                      label="Connect"
                      onClick={() => void connectAi()}
                      loading={aiBusy()}
                    />
                  }
                  items={[]}
                />
              </CapabilityRow>
            }
          >
            {(row) => (
              <CapabilityRow
                title={row().title}
                outcome={row().outcome}
                facts={capabilityFacts(row())}
                muted={row().status === 'off'}
              >
                {aiActions(row().status)}
              </CapabilityRow>
            )}
          </Show>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Team Connections">
        <SettingsCard>
          <Show when={team()}>
            {(row) => (
              <CapabilityRow title={row().title} outcome={row().outcome}>
                <Show
                  when={accountConnected()}
                  fallback={
                    <span class="text-xs text-ink-muted">
                      Connect your GitHub account first
                    </span>
                  }
                >
                  <ConnectAction
                    label="Configure app"
                    href={`${SERVER_HOSTS['document-storage-service']}/github/install-sync`}
                  />
                </Show>
              </CapabilityRow>
            )}
          </Show>
        </SettingsCard>
      </SettingsSection>
      <DisconnectConfirmDialog
        request={disconnect()}
        onClose={() => setDisconnect(null)}
      />
    </SettingsPage>
  );
}
