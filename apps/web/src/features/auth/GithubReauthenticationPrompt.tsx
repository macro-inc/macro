import { authorizeGithub } from '@core/auth/authorize-github';
import { toast } from '@core/component/Toast/Toast';
import { useKeyedPersistentToasts } from '@core/component/Toast/useKeyedPersistentToasts';
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

/** Kick off the OAuth flow; the web navigates away, native completes in-app. */
async function startGithubReauthentication(): Promise<void> {
  try {
    await authorizeGithub(
      (callbackUrl) =>
        throwOnErr(() => authServiceClient.reauthenticateGithub(callbackUrl)),
      'Failed to reconnect GitHub'
    );
  } catch {
    toast.failure('Failed to start GitHub reconnect flow');
  }
}

/**
 * Surfaces a "Reconnect GitHub" prompt when the GitHub grant has expired,
 * probed once on mount. Shares the capped prompt region with the other auth
 * prompts, so it takes its turn instead of stacking on them.
 */
export function GithubReauthenticationPrompt() {
  const [needsReauth, setNeedsReauth] = createSignal(false);

  onMount(() => {
    void checkGithubReauthenticationStatus().then(setNeedsReauth);
  });

  useKeyedPersistentToasts({
    // One GitHub grant per user, so the set is empty or this one fixed key.
    items: () => (needsReauth() ? ['github'] : []),
    key: (item) => item,
    toast: (_item, dismiss) => ({
      title: 'Reconnect GitHub',
      content(): string {
        return 'Your GitHub authorization has expired. Reconnect GitHub to restore pull request details.';
      },
      actions: [
        {
          label: 'Reconnect',
          onClick: () => {
            // Suppress re-prompting while the OAuth flow runs. On the web
            // success navigates away; on native the link status is refetched.
            dismiss();
            void startGithubReauthentication();
          },
        },
      ],
    }),
  });

  return null;
}
