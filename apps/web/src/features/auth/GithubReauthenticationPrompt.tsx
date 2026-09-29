import { authorizeGithub } from '@core/auth/authorize-github';
import { toast } from '@core/component/Toast/Toast';
import { useKeyedPersistentToasts } from '@core/component/Toast/useKeyedPersistentToasts';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import { createSignal, onMount } from 'solid-js';

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
 * probed once on mount. Shares the capped prompt region with the other auth
 * prompts, so it takes its turn instead of stacking on them.
 */
export function GithubReauthenticationPrompt() {
  const [needsReauth, setNeedsReauth] = createSignal(false);
  const [reconnecting, setReconnecting] = createSignal(false);

  async function reconnect() {
    if (reconnecting()) return;
    setReconnecting(true);
    try {
      const connected = await authorizeGithub(
        (callbackUrl) =>
          throwOnErr(() => authServiceClient.reauthenticateGithub(callbackUrl)),
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
