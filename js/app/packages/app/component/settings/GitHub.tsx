import { toast } from '@core/component/Toast/Toast';
import GithubIcon from '@icon/mcp-github.svg';
import {
  useDeleteGithubLinkMutation,
  useGithubLinkStatusQuery,
  useInitGithubLinkMutation,
  useReauthenticateGithubMutation,
} from '@queries/auth';
import { Match, Show, Switch } from 'solid-js';
import { IntegrationRow, SettingsCard } from './primitives';
import {
  ConnectAction,
  type ConnectionState,
  StatusDot,
} from './integration-ui';

/** GitHub integration as a Connected-accounts card. */
export function GitHubCard() {
  const githubLink = useGithubLinkStatusQuery();
  const initGithubLink = useInitGithubLinkMutation();
  const deleteGithubLink = useDeleteGithubLinkMutation();
  const reauthenticateGithub = useReauthenticateGithubMutation();

  const status = () => githubLink.data?.status;
  const username = () => githubLink.data?.username;

  // Drives the connection dot shown beside the "GitHub" title.
  const connectionState = (): ConnectionState | undefined =>
    status() === 'linked'
      ? 'connected'
      : status() === 'reauthentication_required'
        ? 'attention'
        : undefined;
  const connectionLabel = () =>
    connectionState() === 'attention' ? 'Reconnect required' : 'Connected';

  const handleGithubEnable = async () => {
    try {
      window.location.href = await initGithubLink.mutateAsync(
        window.location.href
      );
    } catch {
      toast.failure('Failed to start GitHub connect flow');
    }
  };

  const handleGithubDisable = async () => {
    try {
      await deleteGithubLink.mutateAsync();
    } catch {
      toast.failure('Failed to disconnect GitHub');
    }
  };

  const handleGithubReconnect = async () => {
    try {
      window.location.href = await reauthenticateGithub.mutateAsync(
        window.location.href
      );
    } catch {
      toast.failure('Failed to start GitHub reconnect flow');
    }
  };

  return (
    <SettingsCard>
      <IntegrationRow
        icon={<GithubIcon />}
        title="GitHub"
        description="Surface pull requests and issues alongside your work."
        status={
          <Show when={connectionState()}>
            {(state) => <StatusDot state={state()} label={connectionLabel()} />}
          </Show>
        }
      >
        <Show
          when={!githubLink.isLoading}
          fallback={<span class="text-xs text-ink-muted">Loading…</span>}
        >
          <Switch
            fallback={
              <ConnectAction
                label="Connect"
                onClick={handleGithubEnable}
                disabled={initGithubLink.isPending}
              />
            }
          >
            <Match when={status() === 'linked'}>
              <Show when={username()}>
                {(name) => (
                  <span class="ph-no-capture text-xs text-ink-muted">
                    @{name()}
                  </span>
                )}
              </Show>
              <ConnectAction
                label="Disconnect"
                variant="danger"
                onClick={handleGithubDisable}
                disabled={deleteGithubLink.isPending}
              />
            </Match>
            <Match when={status() === 'reauthentication_required'}>
              <ConnectAction
                label="Reconnect"
                onClick={handleGithubReconnect}
                disabled={reauthenticateGithub.isPending}
              />
            </Match>
          </Switch>
        </Show>
      </IntegrationRow>
    </SettingsCard>
  );
}
