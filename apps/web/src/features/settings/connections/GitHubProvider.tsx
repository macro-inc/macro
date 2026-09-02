import { toast } from '@core/component/Toast/Toast';
import { SERVER_HOSTS } from '@core/constant/servers';
import { createPipedreamCatalogConnect } from '@core/pipedream/catalog';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import {
  useDeleteGithubLinkMutation,
  useInitGithubLinkMutation,
  useReauthenticateGithubMutation,
} from '@queries/auth';
import {
  useDeleteMcpServerMutation,
  useUpdateMcpServerMutation,
} from '@queries/mcp-servers';
import {
  useDeletePipedreamConnectionMutation,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import { Show } from 'solid-js';
import { ConnectAction, StatusDot } from '../integration-ui';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../primitives';
import {
  type ConnectionsModel,
  capabilitiesFor,
  curatedNativeUrl,
} from './model';
import { connectionState, statusLabel } from './status';
import { showConnectionsOverview } from './view-state';

export function GitHubProvider(props: { model: ConnectionsModel }) {
  const rows = () => capabilitiesFor(props.model, 'github');
  const account = () => rows().find((row) => row.id === 'github-account');
  const team = () => rows().find((row) => row.id === 'github-team');
  const ai = () => rows().find((row) => row.id === 'github-ai');
  const ready = () => rows().filter((row) => row.status === 'connected').length;
  const total = () => rows().length + (ai() ? 0 : 1);

  const initGithubLink = useInitGithubLinkMutation();
  const deleteGithubLink = useDeleteGithubLinkMutation();
  const reauthenticateGithub = useReauthenticateGithubMutation();
  const updatePipedream = useUpdatePipedreamConnectionMutation();
  const deletePipedream = useDeletePipedreamConnectionMutation();
  const updateNative = useUpdateMcpServerMutation();
  const deleteNative = useDeleteMcpServerMutation();
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

  const accountLinked =
    account()?.status === 'connected' ||
    account()?.status === 'action-required';

  return (
    <SettingsPage
      title="GitHub"
      description={`${ready()} of ${total()} capabilities ready`}
      onBack={showConnectionsOverview}
    >
      <SettingsSection title="Your connections">
        <SettingsCard>
          <Show when={account()}>
            {(row) => (
              <SettingsRow
                align="start"
                label={
                  <span class="flex items-center gap-2">
                    {row().title}
                    <StatusDot
                      state={connectionState(row().status)}
                      label={statusLabel(row().status)}
                    />
                  </span>
                }
                description={`${row().outcome} ${row().account} · Personal · ${statusLabel(row().status)}`}
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
                        onClick={() => void disconnectAccount()}
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
              </SettingsRow>
            )}
          </Show>

          <Show
            when={ai()}
            fallback={
              <SettingsRow
                align="start"
                label="Use GitHub with Macro AI"
                description="Let Macro AI answer questions about repositories, pull requests, and issues. Personal · Not connected · Powered by Pipedream"
              >
                <ConnectAction
                  label="Connect"
                  onClick={() => void connectAi()}
                  loading={aiBusy()}
                />
              </SettingsRow>
            }
          >
            {(row) => (
              <SettingsRow
                align="start"
                label={
                  <span class="flex items-center gap-2">
                    {row().title}
                    <StatusDot
                      state={connectionState(row().status)}
                      label={statusLabel(row().status)}
                    />
                  </span>
                }
                description={`${row().outcome} ${row().account} · Personal · ${statusLabel(row().status)}${
                  row().mechanism === 'pipedream'
                    ? ' · Powered by Pipedream'
                    : ''
                }`}
              >
                <Show
                  when={row().mechanism === 'pipedream'}
                  fallback={
                    <Show when={row().mechanism === 'native-mcp'}>
                      <ConnectAction
                        label={row().status === 'off' ? 'Turn on' : 'Turn off'}
                        variant="neutral"
                        onClick={() => {
                          const url = curatedNativeUrl('github');
                          if (!url) return;
                          updateNative.mutate(
                            { url, enabled: row().status === 'off' },
                            {
                              onError: () =>
                                toast.failure('Failed to update connector'),
                            }
                          );
                        }}
                        disabled={updateNative.isPending}
                      />
                      <ConnectAction
                        label="Disconnect from Macro"
                        variant="danger"
                        onClick={() => {
                          const url = curatedNativeUrl('github');
                          if (!url) return;
                          deleteNative.mutate(
                            { url },
                            {
                              onSuccess: () =>
                                toast.success(
                                  'Disconnected GitHub AI from Macro'
                                ),
                              onError: () =>
                                toast.failure('Failed to disconnect'),
                            }
                          );
                        }}
                        disabled={deleteNative.isPending}
                      />
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
                      deletePipedream.mutate(
                        { app_slug: 'github' },
                        {
                          onSuccess: () =>
                            toast.success('Disconnected GitHub AI from Macro'),
                          onError: () => toast.failure('Failed to disconnect'),
                        }
                      )
                    }
                    disabled={deletePipedream.isPending}
                  />
                </Show>
              </SettingsRow>
            )}
          </Show>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Team connections">
        <SettingsCard>
          <Show when={team()}>
            {(row) => (
              <SettingsRow
                align="start"
                label={
                  <span class="flex items-center gap-2">
                    {row().title}
                    <StatusDot
                      state={connectionState(row().status)}
                      label={statusLabel(row().status)}
                    />
                  </span>
                }
                description={`${row().outcome} ${row().account} · Team · ${statusLabel(row().status)}`}
              >
                <Show
                  when={accountLinked}
                  fallback={
                    <span class="text-xs text-ink-muted">
                      Connect your GitHub account first
                    </span>
                  }
                >
                  <a
                    href={`${SERVER_HOSTS['document-storage-service']}/github/install-sync`}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-muted outline-none transition-colors hover:bg-ink/4 hover:text-ink focus-visible:bg-ink/6"
                  >
                    Connect
                    <ArrowUpRightIcon class="size-3.5 opacity-70" />
                  </a>
                </Show>
              </SettingsRow>
            )}
          </Show>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}
