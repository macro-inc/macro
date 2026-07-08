import { toast } from '@core/component/Toast/Toast';
import { SERVER_HOSTS } from '@core/constant/servers';
import GithubIcon from '@icon/mcp-github.svg';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
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
import { IntegrationRow, SettingsCard, SettingsRow } from './primitives';

/** GitHub integration as a Connected-accounts card. */
export function GitHubCard() {
  const githubLink = useGithubLinkStatusQuery();
  const initGithubLink = useInitGithubLinkMutation();
  const deleteGithubLink = useDeleteGithubLinkMutation();
  const reauthenticateGithub = useReauthenticateGithubMutation();

  const status = () => githubLink.data?.status;
  const username = () => githubLink.data?.username;

  // Drives the account connection dot.
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
        description="Connect Macro to your GitHub account and repositories."
      />

      <SettingsRow
        label={
          <span class="flex items-center gap-2">
            <span>Account</span>
            <Show when={connectionState()}>
              {(state) => (
                <StatusDot state={state()} label={connectionLabel()} />
              )}
            </Show>
          </span>
        }
        description="Identify your GitHub activity in Macro."
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
      </SettingsRow>

      <SettingsRow
        label="GitHub App"
        description="Choose repositories for Macro to sync."
      >
        <a
          href={`${SERVER_HOSTS['document-storage-service']}/github/install-sync`}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-muted outline-none transition-colors hover:bg-ink/4 hover:text-ink focus-visible:bg-ink/6"
        >
          Install app
          <ArrowUpRightIcon class="size-3.5 opacity-70" />
        </a>
      </SettingsRow>
    </SettingsCard>
  );
}
