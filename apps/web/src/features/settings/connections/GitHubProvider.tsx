import { toast } from '@core/component/Toast/Toast';
import { SERVER_HOSTS } from '@core/constant/servers';
import { createPipedreamCatalogConnect } from '@core/pipedream/catalog';
import {
  useDeleteGithubLinkMutation,
  useInitGithubLinkMutation,
  useReauthenticateGithubMutation,
} from '@queries/auth';
import {
  useDeletePipedreamConnectionMutation,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import { createSignal, Show } from 'solid-js';
import { ConnectAction } from '../integration-ui';
import { SettingsCard, SettingsPage, SettingsSection } from '../primitives';
import { CapabilityRow, capabilityFacts } from './capability-row';
import {
  type DisconnectConfirm,
  DisconnectConfirmDialog,
} from './disconnect-confirm';
import { CURATED_AI, type ConnectionsModel, capabilitiesFor } from './model';
import { useNativeMcpActions } from './native-actions';
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
    } catch {
      toast.failure('Failed to start GitHub connect flow');
    }
  };

  const reconnectAccount = async () => {
    try {
      window.location.href = await reauthenticateGithub.mutateAsync(
        window.location.href
      );
    } catch {
      toast.failure('Failed to start GitHub reconnect flow');
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

  return (
    <SettingsPage
      title="GitHub"
      description="Connect Macro to your GitHub account and repositories."
      onBack={closeConnectionsProvider}
    >
      <SettingsSection title="Your connections">
        <SettingsCard>
          <Show when={account()}>
            {(row) => (
              <CapabilityRow
                title={row().title}
                outcome={row().outcome}
                facts={capabilityFacts(row())}
                status={row().status}
              >
                <Show
                  when={row().status === 'action-required'}
                  fallback={
                    <Show
                      when={row().status === 'connected'}
                      fallback={
                        <ConnectAction
                          label="Connect"
                          onClick={() => void connectAccount()}
                          disabled={initGithubLink.isPending}
                        />
                      }
                    >
                      <ConnectAction
                        label="Disconnect from Macro"
                        variant="danger"
                        onClick={() =>
                          setDisconnect({
                            title: 'Disconnect from Macro',
                            body: 'Disconnect GitHub? Pull requests will stop showing up in Macro.',
                            onConfirm: () => void disconnectAccount(),
                          })
                        }
                        disabled={deleteGithubLink.isPending}
                      />
                    </Show>
                  }
                >
                  <ConnectAction
                    label="Reconnect"
                    onClick={() => void reconnectAccount()}
                    disabled={reauthenticateGithub.isPending}
                  />
                </Show>
              </CapabilityRow>
            )}
          </Show>

          <Show
            when={ai()}
            fallback={
              <CapabilityRow
                title={CURATED_AI.github.title}
                outcome={CURATED_AI.github.outcome}
                facts="Personal · Powered by Pipedream"
              >
                <ConnectAction
                  label="Connect"
                  onClick={() => void connectAi()}
                  loading={aiBusy()}
                />
              </CapabilityRow>
            }
          >
            {(row) => (
              <CapabilityRow
                title={row().title}
                outcome={row().outcome}
                facts={capabilityFacts(row())}
                status={row().status}
              >
                <Show
                  when={row().mechanism === 'pipedream'}
                  fallback={
                    <Show when={row().mechanism === 'native-mcp'}>
                      <Show
                        when={row().status === 'action-required'}
                        fallback={
                          <>
                            <ConnectAction
                              label={
                                row().status === 'off' ? 'Turn on' : 'Turn off'
                              }
                              variant="neutral"
                              onClick={() => {
                                const url = row().sourceUrl;
                                if (!url) return;
                                native.update.mutate(
                                  { url, enabled: row().status === 'off' },
                                  {
                                    onError: () =>
                                      toast.failure(
                                        'Failed to update connector'
                                      ),
                                  }
                                );
                              }}
                              disabled={native.update.isPending}
                            />
                            <ConnectAction
                              label="Disconnect from Macro"
                              variant="danger"
                              onClick={() => {
                                const url = row().sourceUrl;
                                if (!url) return;
                                setDisconnect({
                                  title: 'Disconnect from Macro',
                                  body: 'Disconnect GitHub from Macro AI?',
                                  onConfirm: () =>
                                    native.remove.mutate(
                                      { url },
                                      {
                                        onSuccess: () =>
                                          toast.success(
                                            'Disconnected GitHub AI from Macro'
                                          ),
                                        onError: () =>
                                          toast.failure(
                                            'Failed to disconnect'
                                          ),
                                      }
                                    ),
                                });
                              }}
                              disabled={native.remove.isPending}
                            />
                          </>
                        }
                      >
                        <ConnectAction
                          label="Reconnect"
                          onClick={() => {
                            const url = row().sourceUrl;
                            if (!url) return;
                            native.startAuth(url, row().account);
                          }}
                          disabled={native.authorize.isPending}
                        />
                      </Show>
                    </Show>
                  }
                >
                  <ConnectAction
                    label={row().status === 'off' ? 'Turn on' : 'Turn off'}
                    variant="neutral"
                    onClick={() =>
                      updatePipedream.mutate(
                        {
                          app_slug: 'github',
                          enabled: row().status === 'off',
                        },
                        {
                          onError: () =>
                            toast.failure('Failed to update connector'),
                        }
                      )
                    }
                    disabled={updatePipedream.isPending}
                  />
                  <ConnectAction
                    label="Disconnect from Macro"
                    variant="danger"
                    onClick={() =>
                      setDisconnect({
                        title: 'Disconnect from Macro',
                        body: 'Disconnect GitHub from Macro AI?',
                        onConfirm: () =>
                          deletePipedream.mutate(
                            { app_slug: 'github' },
                            {
                              onSuccess: () =>
                                toast.success(
                                  'Disconnected GitHub AI from Macro'
                                ),
                              onError: () =>
                                toast.failure('Failed to disconnect'),
                            }
                          ),
                      })
                    }
                    disabled={deletePipedream.isPending}
                  />
                </Show>
              </CapabilityRow>
            )}
          </Show>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Team connections">
        <SettingsCard>
          <Show when={team()}>
            {(row) => (
              <CapabilityRow
                title={row().title}
                outcome={row().outcome}
                facts={capabilityFacts(row())}
                status={row().status}
              >
                <Show
                  when={accountConnected()}
                  fallback={
                    <span class="text-xs text-ink-muted">
                      Connect your GitHub account first
                    </span>
                  }
                >
                  <ConnectAction
                    label="Connect"
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
