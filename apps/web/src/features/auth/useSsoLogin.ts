import type { AnalyticsProvider } from '@app/lib/analytics';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import {
  createNativeAuthSession,
  DESKTOP_AUTH_CALLBACK_URL,
  openDesktopAuthSession,
} from '@core/auth/native-auth';
import {
  createSignInAttempt,
  rememberSignInAttempt,
  type SignInAttempt,
  withSignInAttempt,
} from '@core/auth/sign-in-attempt';
import { toast } from '@core/component/Toast/Toast';
import { SERVER_HOSTS, usesLocalStackProxy } from '@core/constant/servers';
import { useEmailLinks } from '@core/email-link';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import type { RedirectLocation } from '@core/util/authRedirect';
import { syncLoginStorage } from '@core/util/cookies';
import { unsetTokenPromise } from '@core/util/fetchWithToken';
import { isPlatform } from '@core/util/platform';
import { setPostLoginRedirect } from '@core/util/postLoginRedirect';
import { holdAutomaticReload } from '@core/util/reloadForNewerBuild';
import { type Span, Telemetry } from '@macro-inc/observability';
import { invalidateAllAfterLogin } from '@queries/auth/user-info';
import { authServiceClient } from '@service-auth/client';
import { useLocation } from '@solidjs/router';
import { DEVELOPMENT_PROXY_PREFIX } from '../../lib/core/constant/developmentProxy';
import { desktopAuthCallbackUrl } from './core/post-auth-target';

/**
 * Binds the session code this sign-in mints to a new attempt: the auth
 * service redeems it only with the attempt's verifier.
 */
async function bindSessionCode(authUrl: URL): Promise<SignInAttempt> {
  const attempt = await createSignInAttempt();
  authUrl.searchParams.set('session_code_challenge', attempt.challenge);
  return attempt;
}

/**
 * Run the hosted flow in the system browser and return through the `macro://`
 * deep link.
 *
 * The callback is pinned rather than derived from the current page by the
 * native navigation plugin: that rewrite only runs for a navigation it
 * classifies as external, so behind the development proxy's same-origin auth
 * host it never fires and the callback lands back in the browser. It also
 * derives the callback from whatever page sign-in started on — normally
 * `/welcome`, which does not redeem session codes.
 *
 * Anything can open a `macro://` link, so the callback names the attempt
 * started here, and the login page redeems only a code for a pending attempt.
 */
async function startDesktopSso(
  authUrl: URL,
  originalLocation: RedirectLocation['originalLocation'] | undefined
) {
  const attempt = await bindSessionCode(authUrl);
  if (!rememberSignInAttempt(attempt)) {
    // Its callback would find no attempt and never sign in.
    console.error('Could not store the sign-in attempt');
    toast.failure('Sign-in failed. Please try again.');
    return;
  }
  // `/login?redirect=` deep links (invites, meetings) ride the callback, so
  // the login page can open them once signed in, before onboarding for an
  // invite.
  authUrl.searchParams.set(
    'original_url',
    withSignInAttempt(
      desktopAuthCallbackUrl(
        DESKTOP_AUTH_CALLBACK_URL,
        new URL(window.location.href).searchParams.get('redirect')
      ),
      attempt
    )
  );

  // The callback route sends the user home, so park the destination they were
  // headed for; BasePathComponent restores it after sign-in.
  if (originalLocation) {
    const { pathname, search, hash } = originalLocation;
    setPostLoginRedirect(`${pathname}${search}${hash}`);
  }

  const result = await openDesktopAuthSession(authUrl.toString());
  if (!result.success) {
    console.error('Failed to open the browser for sign-in', result.error);
    toast.failure('Sign-in failed. Please try again.');
  }
}

type NativeSignInOutcome = 'canceled' | 'failed' | 'redeem_failed' | 'success';

type EmailLinks = ReturnType<typeof useEmailLinks>;

/** Run the hosted flow in the native auth sheet and redeem its session code. */
async function nativeSsoLogin(
  span: Span,
  authUrl: URL,
  initEmailLink: EmailLinks['initEmailLink']
): Promise<NativeSignInOutcome> {
  const session = createNativeAuthSession('login');
  // The sheet hands the code back to this call, so the verifier never needs
  // to outlive it.
  const attempt = await bindSessionCode(authUrl);
  authUrl.searchParams.set('original_url', session.callbackUrl);
  const result = await session.authenticate(authUrl.toString());
  const sessionCode = result.token;

  if (!result.success || !sessionCode) {
    // A canceled sheet is a deliberate user action, not a failure.
    if (result.error === 'User canceled login') return 'canceled';
    console.error('Authentication failed:', result.error);
    toast.failure('Sign-in failed. Please try again.');
    return 'failed';
  }

  const res = await span.run(() =>
    authServiceClient.sessionLogin({
      session_code: sessionCode,
      code_verifier: attempt.verifier,
    })
  );

  if (res.isErr()) {
    console.error('Failed to redeem session code', res.error);
    toast.failure('Sign-in failed. Please try again.');
    return 'redeem_failed';
  }

  // The session cookies are set. From here a reloaded document must check
  // identity rather than show sign-in, so leave the hint now instead of
  // waiting for the identity refetch below to write it.
  syncLoginStorage(true);
  // Reset token state only after the session cookies have actually
  // changed — resetting before sessionLogin opens a window where a
  // visibility-triggered refresh re-latches under the new generation.
  unsetTokenPromise();
  await invalidateAllAfterLogin();
  await initEmailLink().match(
    () => {},
    (err) => {
      if (err.tag !== 'AlreadyInitialized') {
        console.error('Failed to init email link on login', err);
      }
    }
  );
  return 'success';
}

/**
 * The hosted OAuth callback sets cookies on macro.com. A proxied browser, and
 * every native shell, needs the session-code handoff to establish cookies
 * locally instead. A local stack's callback runs on the auth service's own
 * port, where its cookies would reach every stack on the machine, so its proxy
 * ignores them and needs the handoff too.
 */
function needsSessionCodeHandoff(authUrl: URL): boolean {
  return (
    isNativeMobilePlatform() ||
    usesLocalStackProxy() ||
    authUrl.pathname.startsWith(`${DEVELOPMENT_PROXY_PREFIX}/`)
  );
}

export function useSsoLogin(opts?: {
  signupMode?: boolean;
  /** Started on the agent signup page: a new account becomes an agent. */
  isAgent?: boolean;
}) {
  const analytics = useAnalytics();
  const location = useLocation<RedirectLocation>();
  const { initEmailLink } = useEmailLinks();

  return async (idp_name: string) => {
    // Both events are pre-redirect *intent*. The authoritative sign_up (and
    // the ad conversions) fire post-auth when the backend marks the session
    // as a freshly created account — see lib/analytics/signupCompletion.ts.
    const analyticsEvent = opts?.signupMode ? 'sign_up_click' : 'login';
    const analyticsProviders: AnalyticsProvider[] = ['posthog'];

    const authUrl = new URL(`${SERVER_HOSTS['auth-service']}/login/sso`);
    authUrl.searchParams.set('idp_name', idp_name);

    const referral_code =
      new URL(window.location.href).searchParams.get('referral_code') ??
      new URLSearchParams(location.state?.originalLocation?.search).get(
        'referral_code'
      );

    if (referral_code) authUrl.searchParams.set('referral_code', referral_code);
    if (opts?.isAgent) authUrl.searchParams.set('is_agent', 'true');

    const desktop = isPlatform('desktop');
    const handoff = needsSessionCodeHandoff(authUrl);

    if (desktop || handoff) {
      authUrl.searchParams.set('is_mobile', 'true');
    }

    if (isNativeMobilePlatform()) {
      // The sheet's result reaches only this document, and a document loaded
      // before the login hint is down never checks identity. A reload at any
      // point in the sign-in, not only while the sheet is open, shows sign-in
      // again over the session the user just created.
      const releaseReloadHold = holdAutomaticReload();
      try {
        const outcome = await Telemetry.span(
          'auth.native_sign_in',
          async (span) => {
            const outcome = await nativeSsoLogin(span, authUrl, initEmailLink);
            span.setAttr('auth.native_sign_in.outcome', outcome);
            return outcome;
          }
        );

        if (outcome === 'success' || outcome === 'redeem_failed') {
          analytics.track(
            analyticsEvent,
            { method: idp_name },
            analyticsProviders
          );
        }
      } finally {
        releaseReloadHold();
      }

      return;
    }

    if (desktop) {
      analytics.track(analyticsEvent, { method: idp_name }, analyticsProviders);
      await startDesktopSso(authUrl, location.state?.originalLocation);
      return;
    }

    const originalLocation = location.state?.originalLocation;
    let originalUrl = originalLocation
      ? `${window.location.origin}${originalLocation.pathname}${originalLocation.search}${originalLocation.hash}`
      : window.location.href;
    if (handoff) {
      // The code returns on the URL, after a full-page redirect: remember
      // the attempt so the page it lands on can tell it from someone else's.
      const attempt = await bindSessionCode(authUrl);
      if (!rememberSignInAttempt(attempt)) {
        console.error('Could not store the sign-in attempt');
        toast.failure('Sign-in failed. Please try again.');
        return;
      }
      originalUrl = withSignInAttempt(originalUrl, attempt);
    }
    authUrl.searchParams.set('original_url', originalUrl);

    analytics.track(analyticsEvent, { method: idp_name }, analyticsProviders);

    // The hosted callback sets only HttpOnly cookies, which the app cannot
    // see, and the return load probes identity only behind the login hint.
    // Leave the hint now so that load checks the new session instead of
    // showing sign-in again; a sign-in that did not complete 401s and clears it.
    syncLoginStorage(true);
    window.location.href = authUrl.toString();
  };
}
