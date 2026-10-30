import { authorizeGithub } from '@core/auth/authorize-github';
import { toast } from '@core/component/Toast/Toast';
import { SERVER_HOSTS } from '@core/constant/servers';
import { fireAndForget } from '@core/util/fireAndForget';
import GithubIcon from '@icon/mcp-github.svg';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import {
  useDeleteGithubLinkMutation,
  useGithubLinkStatusQuery,
  useInitGithubLinkMutation,
  useReauthenticateGithubMutation,
} from '@queries/auth';
import { Match, Show, Switch } from 'solid-js';
import {
  ConnectAction,
  type ConnectionState,
  StatusDot,
} from './integration-ui';
import { IntegrationRow, SettingsCard } from './primitives';

/** The viewer's GitHub account link and the actions that change it. */
export function useGithubConnection() {
  const githubLink = useGithubLinkStatusQuery();
  const initGithubLink = useInitGithubLinkMutation();
  const deleteGithubLink = useDeleteGithubLinkMutation();
  const reauthenticateGithub = useReauthenticateGithubMutation();

  const status = () =>
    githubLink.isSuccess ? githubLink.data.status : undefined;
  const username = () =>
    githubLink.isSuccess ? githubLink.data.username : undefined;

  // Drives the account connection dot.
  const connectionState = (): ConnectionState | undefined =>
    status() === 'linked'
      ? 'connected'
      : status() === 'reauthentication_required'
        ? 'attention'
        : undefined;

  const connect = async () => {
    try {
      await authorizeGithub(
        (callbackUrl) => initGithubLink.mutateAsync(callbackUrl),
        'Failed to connect GitHub'
      );
    } catch {
      toast.failure('Failed to start GitHub connect flow');
    }
  };

  const disconnect = async () => {
    try {
      await deleteGithubLink.mutateAsync();
    } catch {
      toast.failure('Failed to disconnect GitHub');
    }
  };

  const reconnect = async () => {
    try {
      await authorizeGithub(
        (callbackUrl) => reauthenticateGithub.mutateAsync(callbackUrl),
        'Failed to reconnect GitHub'
      );
    } catch {
      toast.failure('Failed to start GitHub reconnect flow');
    }
  };

  return {
    loading: () => githubLink.isLoading,
    status,
    username,
    connectionState,
    connect,
    disconnect,
    reconnect,
    connecting: () => initGithubLink.isPending,
    disconnecting: () => deleteGithubLink.isPending,
    reconnecting: () => reauthenticateGithub.isPending,
  };
}

/** Where the viewer installs or configures the GitHub App for their repositories. */
export const GITHUB_APP_INSTALL_URL = `${SERVER_HOSTS['document-storage-service']}/github/install-sync`;

/** GitHub account link, one row on the Integrations page. */
export function GitHubCard(props: { class?: string } = {}) {
  const github = useGithubConnection();
  const connectionLabel = () =>
    github.connectionState() === 'attention'
      ? 'Reconnect required'
      : 'Connected';

  return (
    <SettingsCard class={props.class}>
      <IntegrationRow
        icon={<GithubIcon />}
        title="GitHub"
        description="Review your pull requests in Macro, see live pull request status in docs and chats, and let agents work in your repositories."
        status={
          <Show when={github.connectionState()}>
            {(state) => <StatusDot state={state()} label={connectionLabel()} />}
          </Show>
        }
      >
        <Show
          when={!github.loading()}
          fallback={<span class="text-sm text-ink-muted">Loading…</span>}
        >
          <Switch
            fallback={
              <ConnectAction
                label="Connect"
                onClick={() =>
                  fireAndForget(github.connect(), 'github-settings')
                }
                disabled={github.connecting()}
              />
            }
          >
            <Match when={github.status() === 'linked'}>
              <Show when={github.username()}>
                {(name) => (
                  <span class="ph-no-capture text-sm text-ink-muted">
                    @{name()}
                  </span>
                )}
              </Show>
              <ConnectAction
                label="Disconnect"
                variant="danger"
                onClick={() =>
                  fireAndForget(github.disconnect(), 'github-settings')
                }
                disabled={github.disconnecting()}
              />
            </Match>
            <Match when={github.status() === 'reauthentication_required'}>
              <ConnectAction
                label="Reconnect"
                onClick={() =>
                  fireAndForget(github.reconnect(), 'github-settings')
                }
                disabled={github.reconnecting()}
              />
            </Match>
          </Switch>
        </Show>
        <Show when={github.status() === 'linked'}>
          <a
            href={GITHUB_APP_INSTALL_URL}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-muted outline-none transition-colors hover:bg-ink/4 hover:text-ink focus-visible:bg-ink/6"
          >
            Configure app
            <ArrowUpRightIcon class="size-3.5 opacity-70" />
          </a>
        </Show>
      </IntegrationRow>
    </SettingsCard>
  );
}
