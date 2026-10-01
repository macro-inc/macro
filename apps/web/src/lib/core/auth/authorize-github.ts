import { createNativeAuthSession } from '@core/auth/native-auth';
import { toast } from '@core/component/Toast/Toast';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { invalidateGithubLinkStatus } from '@queries/auth';

/**
 * Run a GitHub OAuth grant. On the web the browser navigates to GitHub and the
 * callback returns to this page, so nothing after the call runs. On native
 * mobile the grant completes in the system browser and the link status query
 * is refreshed; resolves to whether that grant succeeded. Rejects when the
 * authorization URL cannot be obtained.
 */
export async function authorizeGithub(
  getAuthorizationUrl: (callbackUrl: string) => Promise<string>,
  failureMessage: string
): Promise<boolean> {
  const session = isNativeMobilePlatform()
    ? createNativeAuthSession('github-link-callback')
    : undefined;
  const url = await getAuthorizationUrl(
    session?.callbackUrl ?? window.location.href
  );
  if (!session) {
    window.location.href = url;
    return false;
  }
  const result = await session.authenticate(url);
  if (result.success) {
    await invalidateGithubLinkStatus();
    return true;
  }
  // A canceled browser is a deliberate user action, not a failure.
  if (result.error !== 'User canceled login') toast.failure(failureMessage);
  return false;
}
