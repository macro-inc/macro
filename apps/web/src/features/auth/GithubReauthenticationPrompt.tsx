import { toast } from '@core/component/Toast/Toast';
import { authServiceClient } from '@service-auth/client';
import { onMount } from 'solid-js';

let githubReauthenticationToastId: number | undefined;

function clearGithubReauthenticationToastState(): void {
  githubReauthenticationToastId = undefined;
}

async function handleGithubReauthenticationToastAction(): Promise<void> {
  if (githubReauthenticationToastId !== undefined) {
    toast.dismiss(githubReauthenticationToastId);
  }
  clearGithubReauthenticationToastState();

  const result = await authServiceClient.reauthenticateGithub(
    window.location.href
  );

  if (result.isErr()) {
    toast.failure('Failed to start GitHub reconnect flow');
    return;
  }

  window.location.href = result.value;
}

function showGithubReauthenticationToast(): void {
  if (githubReauthenticationToastId !== undefined) return;

  githubReauthenticationToastId = toast.custom(
    {
      title: 'Reconnect GitHub',
      content(): string {
        return 'Your GitHub authorization has expired. Reconnect GitHub to restore pull request details.';
      },
      actions: [
        {
          label: 'Reconnect',
          onClick: handleGithubReauthenticationToastAction,
        },
      ],
    },
    {
      persistent: true,
      onDismiss: clearGithubReauthenticationToastState,
    }
  );
}

async function checkGithubReauthenticationStatus(): Promise<void> {
  const response = await authServiceClient.checkGithubLinkStatus();

  const needsReauthentication = response.isOk()
    ? response.value.reauthentication_required
    : response.error.some(
        (error) => error.code === 'REAUTHENTICATION_REQUIRED'
      );

  if (needsReauthentication) {
    showGithubReauthenticationToast();
  }
}

export function GithubReauthenticationPrompt() {
  onMount(() => {
    void checkGithubReauthenticationStatus();
  });

  return null;
}
