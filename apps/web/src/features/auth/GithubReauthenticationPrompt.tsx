import { createNativeAuthSession } from '@core/auth/native-auth';
import { toast } from '@core/component/Toast/Toast';
import { useKeyedPersistentToasts } from '@core/component/Toast/useKeyedPersistentToasts';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { invalidateGithubLinkStatus } from '@queries/auth';
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

/** Kick off the OAuth flow; on success the browser navigates away. */
async function startGithubReauthentication(): Promise<void> {
  const session = isNativeMobilePlatform()
    ? createNativeAuthSession('github-link-callback')
    : undefined;
  const result = await authServiceClient.reauthenticateGithub(
    session?.callbackUrl ?? window.location.href
  );

  if (result.isErr()) {
    toast.failure('Failed to start GitHub reconnect flow');
    return;
  }

  if (!session) {
    window.location.href = result.value;
    return;
  }
  const auth = await session.authenticate(result.value);
  if (auth.success) {
    await invalidateGithubLinkStatus();
  } else if (auth.error !== 'User canceled login') {
    toast.failure('Failed to reconnect GitHub');
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
            // Suppress re-prompting while the OAuth flow runs; success
            // navigates the page away entirely.
            dismiss();
            void startGithubReauthentication();
          },
        },
      ],
    }),
  });

  return null;
}
