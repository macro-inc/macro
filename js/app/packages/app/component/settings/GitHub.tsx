import { toast } from '@core/component/Toast/Toast';
import GithubIcon from '@icon/mcp-github.svg';
import { authServiceClient } from '@service-auth/client';
import { createResource, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { Button } from '@ui';
import {
  ConnectionHero,
  type ConnectionState,
  IntegrationPanelShell,
  StatusPill,
} from './integration-ui';

type GithubLinkStatus = 'linked' | 'unlinked' | 'reauthentication_required';

type GithubLink = {
  status: GithubLinkStatus;
  // Populated once the auth service starts returning the linked account's
  // handle on /link/github/status. Until then it stays undefined and the
  // username line below simply doesn't render.
  username?: string;
};

export function GitHub() {
  const [githubLink, { refetch: refetchGithubLink }] = createResource(
    async (): Promise<GithubLink> => {
      const response = await authServiceClient.checkGithubLinkStatus();

      if (response.isOk()) {
        // `github_username` is not yet part of the generated response schema;
        // read it defensively so the UI lights up automatically once the
        // backend includes it.
        const username =
          (response.value as { github_username?: string | null })
            .github_username ?? undefined;
        return {
          status: response.value.reauthentication_required
            ? 'reauthentication_required'
            : 'linked',
          username,
        };
      }

      const needsReauthentication = response.error.some(
        (error) => error.code === 'REAUTHENTICATION_REQUIRED'
      );
      return {
        status: needsReauthentication
          ? 'reauthentication_required'
          : 'unlinked',
      };
    }
  );

  const status = () => githubLink()?.status;

  const handleGithubEnable = async () => {
    const url = await authServiceClient.initGithubLink(window.location.href);
    if (url.isOk()) {
      window.location.href = url.value;
    }
  };

  const handleGithubDisable = async () => {
    await authServiceClient.deleteGithubLink();
    refetchGithubLink();
  };

  const handleGithubReconnect = async () => {
    const url = await authServiceClient.reauthenticateGithub(
      window.location.href
    );
    if (url.isOk()) {
      window.location.href = url.value;
    } else {
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
        when={!githubLink.loading}
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
          status={
            <div class="flex flex-col items-center gap-2">
              <StatusPill state={pill().state} label={pill().label} />
              <Show when={status() === 'linked' && githubLink()?.username}>
                {(username) => (
                  <span class="ph-no-capture text-sm text-ink">
                    @{username()}
                  </span>
                )}
              </Show>
            </div>
          }
        >
          <Show when={status() === 'reauthentication_required'}>
            <Button
              variant="cta"
              size="md"
              depth={3}
              onClick={handleGithubReconnect}
            >
              Reconnect
            </Button>
          </Show>
          <Show when={status() === 'linked'}>
            <Button
              variant="base"
              size="md"
              depth={3}
              onClick={handleGithubDisable}
            >
              Disconnect
            </Button>
          </Show>
          <Show
            when={
              status() !== 'linked' && status() !== 'reauthentication_required'
            }
          >
            <Button
              variant="cta"
              size="md"
              depth={3}
              onClick={handleGithubEnable}
            >
              Connect GitHub
            </Button>
          </Show>
        </ConnectionHero>
      </Show>
    </IntegrationPanelShell>
  );
}
