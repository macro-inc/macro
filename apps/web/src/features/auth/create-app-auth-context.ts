import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { GOOGLE_GMAIL_IDP, MICROSOFT_IDP } from '@core/auth/email';
import { toast } from '@core/component/Toast/Toast';
import { deriveIsAuthenticated } from '@core/context/user';
import { useEmailLinks } from '@core/email-link';
import { unsetTokenPromise } from '@core/util/fetchWithToken';
import {
  invalidateAllAfterLogin,
  useUserInfoQuery,
} from '@queries/auth/user-info';
import { queryReadyGate } from '@queries/gate';
import { detect } from 'detect-browser';
import { match } from 'ts-pattern';
import type { AuthContext, AuthSession } from './context/auth-context';
import {
  exchangeSessionCode,
  sendEmailCode,
  verifyEmailCode,
} from './queries/auth-requests';
import { useSsoLogin } from './useSsoLogin';

/** Real auth service, analytics, and session refresh behind the auth contract. */
export function createAppAuthContext(): AuthContext {
  const analytics = useAnalytics();
  const userInfo = useUserInfoQuery();
  const { initEmailLink } = useEmailLinks();
  const loginSso = useSsoLogin();
  const signupSso = useSsoLogin({ signupMode: true });
  const agentSignupSso = useSsoLogin({ signupMode: true, isAgent: true });

  const session = (): AuthSession => {
    const data = queryReadyGate(userInfo) ? userInfo.data : undefined;
    // A signed-out visitor's request 401s rather than answering unauthenticated.
    const authenticated = deriveIsAuthenticated({
      isLoading: userInfo.isLoading,
      isError: userInfo.isError,
      error: userInfo.error,
      data,
    });
    if (authenticated === false) return { t: 'signed-out' };
    if (!data?.userId) return { t: 'loading' };
    return {
      t: 'signed-in',
      user: {
        id: data.userId,
        email: data.email ?? undefined,
        tutorialComplete: data.tutorialComplete === true,
        isAgent: data.isAgent === true,
      },
    };
  };

  const completeLogin = async () => {
    // Reset token state only after the session cookies have changed; resetting
    // earlier lets a visibility-triggered refresh re-latch the old generation.
    unsetTokenPromise();
    await invalidateAllAfterLogin();
    await initEmailLink().match(
      () => {},
      (error) => {
        if (error.tag !== 'AlreadyInitialized')
          console.error('Failed to init email link on login', error);
      }
    );
  };

  return {
    session,
    startSso: (provider, intent) => {
      const startSsoFor = match(intent)
        .with('login', () => loginSso)
        .with('signup', () => signupSso)
        .with('agent-signup', () => agentSignupSso)
        .exhaustive();
      const idpName = match(provider)
        .with('google', () => GOOGLE_GMAIL_IDP)
        .with('microsoft', () => MICROSOFT_IDP)
        .with('apple', () => 'Apple')
        .exhaustive();
      return startSsoFor(idpName);
    },
    sendEmailCode,
    verifyEmailCode,
    redeemSessionToken: async (token) => {
      if (!(await exchangeSessionCode(token))) return false;
      await completeLogin();
      return true;
    },
    completeLogin,
    identify: (user) =>
      analytics.identify(user.id, {
        email: user.email,
        os: detect(navigator.userAgent)?.os?.replaceAll(' ', ''),
      }),
    pageView: (name) => analytics.pageView(name),
    track: (event, data) => analytics.track(event, data),
    notifyFailure: (message) => toast.failure(message),
  };
}
