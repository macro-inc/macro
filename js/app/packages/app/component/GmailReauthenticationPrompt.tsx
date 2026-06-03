import { GOOGLE_GMAIL_IDP } from '@core/auth/email';
import { toast } from '@core/component/Toast/Toast';
import { authServiceClient } from '@service-auth/client';
import { onMount } from 'solid-js';
import { useSsoLogin } from './auth/useSsoLogin';

let gmailReauthenticationToastId: number | undefined;

function clearGmailReauthenticationToastState(): void {
  gmailReauthenticationToastId = undefined;
}

async function handleGmailReauthenticationToastAction(
  startSsoLogin: (idpName: string) => Promise<void>
): Promise<void> {
  if (gmailReauthenticationToastId !== undefined) {
    toast.dismiss(gmailReauthenticationToastId);
  }
  clearGmailReauthenticationToastState();

  const logoutResult = await authServiceClient.logout();
  if (logoutResult.isErr()) {
    toast.failure('Failed to log out before Gmail reconnect');
    return;
  }

  await startSsoLogin(GOOGLE_GMAIL_IDP);
}

function showGmailReauthenticationToast(
  startSsoLogin: (idpName: string) => Promise<void>
): void {
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
          onClick: () => handleGmailReauthenticationToastAction(startSsoLogin),
        },
      ],
    },
    {
      persistent: true,
      onDismiss: clearGmailReauthenticationToastState,
    }
  );
}

async function checkGmailReauthenticationStatus(
  startSsoLogin: (idpName: string) => Promise<void>
): Promise<void> {
  const response = await authServiceClient.checkGmailLinkStatus();

  const needsReauthentication = response.isOk()
    ? response.value.reauthentication_required
    : response.error.some(
        (error) => error.code === 'REAUTHENTICATION_REQUIRED'
      );

  if (needsReauthentication) {
    showGmailReauthenticationToast(startSsoLogin);
  }
}

export function GmailReauthenticationPrompt() {
  const startSsoLogin = useSsoLogin();

  onMount(() => {
    void checkGmailReauthenticationStatus(startSsoLogin);
  });

  return null;
}
