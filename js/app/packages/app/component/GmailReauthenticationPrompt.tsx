import { emailAuthUrl } from '@core/auth/email';
import { toast } from '@core/component/Toast/Toast';
import { authServiceClient } from '@service-auth/client';
import { onMount } from 'solid-js';

let gmailReauthenticationToastId: number | undefined;

function clearGmailReauthenticationToastState(): void {
  gmailReauthenticationToastId = undefined;
}

function handleGmailReauthenticationToastAction(): void {
  if (gmailReauthenticationToastId !== undefined) {
    toast.dismiss(gmailReauthenticationToastId);
  }
  clearGmailReauthenticationToastState();

  window.location.href = emailAuthUrl({
    returnPath: `${window.location.pathname}${window.location.search}${window.location.hash}`,
  });
}

function showGmailReauthenticationToast(): void {
  if (gmailReauthenticationToastId !== undefined) return;

  gmailReauthenticationToastId = toast.custom(
    {
      title: 'Reconnect Gmail',
      content(): string {
        return 'Your Gmail authorization has expired. Reconnect Gmail to restore email sync.';
      },
      actions: [
        {
          label: 'Reconnect',
          onClick: handleGmailReauthenticationToastAction,
        },
      ],
    },
    {
      persistent: true,
      onDismiss: clearGmailReauthenticationToastState,
    }
  );
}

async function checkGmailReauthenticationStatus(): Promise<void> {
  const response = await authServiceClient.checkGmailLinkStatus();

  const needsReauthentication = response.isOk()
    ? response.value.reauthentication_required
    : response.error.some(
        (error) => error.code === 'REAUTHENTICATION_REQUIRED'
      );

  if (needsReauthentication) {
    showGmailReauthenticationToast();
  }
}

export function GmailReauthenticationPrompt() {
  onMount(() => {
    void checkGmailReauthenticationStatus();
  });

  return null;
}
