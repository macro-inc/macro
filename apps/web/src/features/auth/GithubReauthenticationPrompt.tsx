import { authorizeGithub } from '@core/auth/authorize-github';
import { toast } from '@core/component/Toast/Toast';
import { useKeyedPersistentToasts } from '@core/component/Toast/useKeyedPersistentToasts';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { useReauthenticateGithubMutation } from '@queries/auth';
import { authServiceClient } from '@service-auth/client';
import { createSignal, onCleanup, onMount } from 'solid-js';

async function checkGithubReauthenticationStatus(): Promise<boolean> {
  const response = await authServiceClient.checkGithubLinkStatus();
  return response.isOk()
    ? response.value.reauthentication_required
    : response.error.some(
        (error) => error.code === 'REAUTHENTICATION_REQUIRED'
      );
}

/**
 * Surfaces a "Reconnect GitHub" prompt when the GitHub grant has expired,
 * probed on mount and browser history restoration. Shares the capped prompt
 * region with the other auth prompts, so it takes its turn instead of stacking.
 */
export function GithubReauthenticationPrompt() {
  const [needsReauth, setNeedsReauth] = createSignal(false);
  const [reconnecting, setReconnecting] = createSignal(false);
  const reauthenticateGithub = useReauthenticateGithubMutation();

  async function reconnect() {
    if (reconnecting()) return;
    setReconnecting(true);
    try {
      const connected = await authorizeGithub(
        (callbackUrl) => reauthenticateGithub.mutateAsync(callbackUrl),
        'Failed to reconnect GitHub'
      );
      if (connected) setNeedsReauth(false);
      // Browser OAuth is navigating away. Native OAuth settles in this view.
      if (!isNativeMobilePlatform()) return;
    } catch {
      toast.failure('Failed to start GitHub reconnect flow');
    }
    setReconnecting(false);
  }

  onMount(() => {
    void checkGithubReauthenticationStatus().then(setNeedsReauth);
    if (isNativeMobilePlatform()) return;

    async function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      try {
        setNeedsReauth(await checkGithubReauthenticationStatus());
      } catch {
        // Preserve the previous status if the restored page cannot reach auth.
      } finally {
        setReconnecting(false);
      }
    }

    window.addEventListener('pageshow', onPageShow);
    onCleanup(() => window.removeEventListener('pageshow', onPageShow));
  });

  useKeyedPersistentToasts({
    // One GitHub grant per user, so the set is empty or this one fixed key.
    items: () => (needsReauth() && !reconnecting() ? ['github'] : []),
    key: (item) => item,
    toast: () => ({
      title: 'Reconnect GitHub',
      content(): string {
        return 'Your GitHub authorization has expired. Reconnect GitHub to restore pull request details.';
      },
      actions: [
        {
          label: 'Reconnect',
          onClick: () => {
            void reconnect();
          },
        },
      ],
    }),
  });

  return null;
}
