import { toast } from '@core/component/Toast/Toast';
import GithubIcon from '@icon/mcp-github.svg';
import {
  useDeleteGithubLinkMutation,
  useGithubLinkStatusQuery,
  useInitGithubLinkMutation,
  useReauthenticateGithubMutation,
} from '@queries/auth';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import { Button } from '@ui';
import {
  ConnectionHero,
  type ConnectionState,
  IntegrationPanelShell,
  StatusPill,
} from './integration-ui';

export function GitHub() {
  const githubLink = useGithubLinkStatusQuery();
  const initGithubLink = useInitGithubLinkMutation();
  const deleteGithubLink = useDeleteGithubLinkMutation();
  const reauthenticateGithub = useReauthenticateGithubMutation();

  const status = () => githubLink.data?.status;

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

  const pill = (): { state: ConnectionState; label: string } =>
    match(status())
      .with('linked', () => ({ state: 'connected', label: 'Connected' }) as const)
      .with(
        'reauthentication_required',
        () => ({ state: 'attention', label: 'Reconnect required' }) as const
      )
      .otherwise(
        () => ({ state: 'disconnected', label: 'Not connected' }) as const
      );

  return (
    <IntegrationPanelShell title="GitHub">
      <Show
        when={!githubLink.isLoading}
        fallback={
          <div class="flex items-center justify-center pt-24 text-sm text-ink-muted">
            Loading…
          </div>
        }
      >
        <ConnectionHero
          icon={GithubIcon}
          title="GitHub"
          description="Connect your GitHub account so Macro can surface pull requests and issues alongside your work."
        >
          <div class="flex flex-col items-center gap-2">
            <div class="flex items-center gap-3">
              <StatusPill state={pill().state} label={pill().label} />
              <Show when={status() === 'reauthentication_required'}>
                <Button
                  variant="cta"
                  size="sm"
                  depth={3}
                  onClick={handleGithubReconnect}
                  disabled={reauthenticateGithub.isPending}
                >
                  Reconnect
                </Button>
              </Show>
              <Show when={status() === 'linked'}>
                <Button
                  variant="base"
                  size="sm"
                  depth={3}
                  onClick={handleGithubDisable}
                  disabled={deleteGithubLink.isPending}
                >
                  Disconnect
                </Button>
              </Show>
              <Show
                when={
                  status() !== 'linked' &&
                  status() !== 'reauthentication_required'
                }
              >
                <Button
                  variant="cta"
                  size="sm"
                  depth={3}
                  onClick={handleGithubEnable}
                  disabled={initGithubLink.isPending}
                >
                  Connect GitHub
                </Button>
              </Show>
            </div>
            <Show when={status() === 'linked' && githubLink.data?.username}>
              {(username) => (
                <span class="ph-no-capture text-sm text-ink">
                  @{username()}
                </span>
              )}
            </Show>
          </div>
        </ConnectionHero>
      </Show>
    </IntegrationPanelShell>
  );
}
