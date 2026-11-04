import {
  createNativeAuthSession,
  openDesktopAuthSession,
} from '@core/auth/native-auth';
import { toast } from '@core/component/Toast/Toast';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { fireAndForget } from '@core/util/fireAndForget';
import { isDesktopPlatform } from '@core/util/platform';
import { Telemetry } from '@macro-inc/observability';
import {
  githubLinkAuthorizationUrl,
  invalidateGithubLinkStatus,
} from '@queries/auth';

/**
 * Where GitHub consent started from the desktop app returns. The system
 * browser cannot load the webview's own origin, so the auth service redirects
 * to this deep link once the account is linked, and the navigation bridge
 * consumes it without changing the active route.
 */
export const GITHUB_LINK_CALLBACK_PATH = '/github-link-callback';
const DESKTOP_GITHUB_LINK_CALLBACK_URL = `macro://${GITHUB_LINK_CALLBACK_PATH}`;

/**
 * Run a GitHub OAuth grant. On the web the browser navigates to GitHub and the
 * callback returns to this page, so nothing after the call runs. The desktop
 * app opens consent in the system browser and learns the outcome from the
 * `macro://` callback, so it resolves to false once the browser opens. On
 * native mobile the grant completes in the system browser and the link status
 * query is refreshed; resolves to whether that grant succeeded. Rejects when
 * the authorization URL cannot be obtained.
 */
export async function authorizeGithub(
  getAuthorizationUrl: (callbackUrl: string) => Promise<string>,
  failureMessage: string
): Promise<boolean> {
  if (isDesktopPlatform()) {
    const url = await getAuthorizationUrl(DESKTOP_GITHUB_LINK_CALLBACK_URL);
    await Telemetry.span('github.link.open_browser', async (span) => {
      const opened = await openDesktopAuthSession(url);
      if (opened.success) return;
      span.error('Unable to open GitHub connection browser');
      toast.failure(failureMessage);
    });
    return false;
  }
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

/**
 * Consume the desktop GitHub consent return. The auth service redirects here
 * only after linking the account, so refresh the link status for every reader.
 */
export function handleGithubLinkCallback(path: string): boolean {
  if (path !== GITHUB_LINK_CALLBACK_PATH) return false;
  fireAndForget(invalidateGithubLinkStatus(), 'github-link');
  return true;
}

/**
 * Link the user's GitHub account, or relink one whose token stopped working.
 * The link also authorizes GitHub for Macro AI. Resolves as
 * {@link authorizeGithub} does.
 */
export async function linkGithubAccount(
  failureMessage: string
): Promise<boolean> {
  return await authorizeGithub(githubLinkAuthorizationUrl, failureMessage);
}
