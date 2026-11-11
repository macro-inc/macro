import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { MOBILE_WEB_SIGNUP_LEAD_VALUE } from '@app/lib/analytics/leadValues';
import { adAttributionForCapture } from '@app/lib/analytics/signupAttribution';
import { GOOGLE_GMAIL_IDP, MICROSOFT_IDP } from '@core/auth/email';
import { toast } from '@core/component/Toast/Toast';
import { deriveIsAuthenticated } from '@core/context/user';
import { useEmailLinks } from '@core/email-link';
import { unsetTokenPromise } from '@core/util/fetchWithToken';
import { useSendMobileWelcomeEmail } from '@queries/auth';
import {
  invalidateAllAfterLogin,
  useUserInfoQuery,
} from '@queries/auth/user-info';
import { queryReadyGate } from '@queries/gate';
import { detect } from 'detect-browser';
import { createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import type { AuthContext, AuthSession } from './context/auth-context';
import {
  exchangeSessionCode,
  sendEmailCode,
  verifyEmailCode,
} from './queries/auth-requests';
import { useSsoLogin } from './useSsoLogin';

/** Real auth service, analytics, and session refresh behind the auth contract. */
export function createAppAuthContext(options?: {
  requireFreshLogin?: boolean;
}): AuthContext {
  const [loginCompleted, setLoginCompleted] = createSignal(false);
  const analytics = useAnalytics();
  const userInfo = useUserInfoQuery();
  const { initEmailLink } = useEmailLinks();
  const loginSso = useSsoLogin({
    onAuthenticated: () => setLoginCompleted(true),
  });
  const signupSso = useSsoLogin({ signupMode: true });
  const agentSignupSso = useSsoLogin({ signupMode: true, isAgent: true });
  const sendWelcomeEmail = useSendMobileWelcomeEmail();

  const session = (): AuthSession => {
    if (options?.requireFreshLogin && !loginCompleted())
      return { t: 'signed-out' };
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
    setLoginCompleted(true);
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
    sendMobileWelcomeEmail: async (email) => {
      const attribution = adAttributionForCapture();
      const result = await sendWelcomeEmail.mutateAsync(
        Object.keys(attribution).length > 0 ? { email, attribution } : { email }
      );
      if (result.isOk()) return { t: 'sent', alreadySent: !result.value.sent };
      const code = result.error[0]?.code;
      if (code === 'INVALID_EMAIL') return { t: 'invalid-email' };
      if (code === 'RATE_LIMITED') return { t: 'rate-limited' };
      return { t: 'failed' };
    },
    identify: (user) =>
      analytics.identify(user.id, {
        email: user.email,
        os: detect(navigator.userAgent)?.os?.replaceAll(' ', ''),
        setOnce: user.setOnce,
      }),
    trackMobileSignupLead: (email) => {
      // Lead feeds an existing custom conversion; Meta's Maximize Value
      // campaigns need CompleteRegistration, so both fire.
      const lead = {
        content_name: 'mobile_web_signup',
        value: MOBILE_WEB_SIGNUP_LEAD_VALUE,
        currency: 'USD',
      };
      analytics.trackMeta('Lead', lead);
      analytics.trackMeta('CompleteRegistration', lead);
      analytics.trackGoogleConversion('mobile_web_lead', {
        value: MOBILE_WEB_SIGNUP_LEAD_VALUE,
        currency: 'USD',
        transaction_id: email,
      });
    },
    pageView: (name) => analytics.pageView(name),
    track: (event, data) => analytics.track(event, data),
    notifyFailure: (message) => toast.failure(message),
  };
}
