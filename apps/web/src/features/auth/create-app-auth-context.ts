import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { MOBILE_WEB_SIGNUP_LEAD_VALUE } from '@app/lib/analytics/leadValues';
import { GOOGLE_GMAIL_IDP } from '@core/auth/email';
import { toast } from '@core/component/Toast/Toast';
import { useEmailLinks } from '@core/email-link';
import { unsetTokenPromise } from '@core/util/fetchWithToken';
import { useSendMobileWelcomeEmail } from '@queries/auth';
import {
  invalidateAllAfterLogin,
  useUserInfoQuery,
} from '@queries/auth/user-info';
import { detect } from 'detect-browser';
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
  const sendWelcomeEmail = useSendMobileWelcomeEmail();

  const session = (): AuthSession => {
    const data = userInfo.isSuccess ? userInfo.data : undefined;
    if (!data) return { t: 'loading' };
    if (!data.authenticated || !data.userId) return { t: 'signed-out' };
    return {
      t: 'signed-in',
      user: {
        id: data.userId,
        email: data.email ?? undefined,
        tutorialComplete: data.tutorialComplete === true,
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
    startSso: (provider, intent) =>
      (intent === 'signup' ? signupSso : loginSso)(
        provider === 'google' ? GOOGLE_GMAIL_IDP : 'Apple'
      ),
    sendEmailCode,
    verifyEmailCode,
    redeemSessionToken: async (token) => {
      if (!(await exchangeSessionCode(token))) return false;
      await completeLogin();
      return true;
    },
    completeLogin,
    sendMobileWelcomeEmail: async (email) => {
      const result = await sendWelcomeEmail.mutateAsync(email);
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
