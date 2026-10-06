import type { AppEvents } from '@app/lib/analytics/app-events';
import { type Accessor, createContext, useContext } from 'solid-js';
import type { MobileWelcomeResult } from '../core/mobile-welcome';

export type AuthUser = {
  id: string;
  email: string | undefined;
  tutorialComplete: boolean;
};

export type AuthSession =
  | { t: 'loading' }
  | { t: 'signed-out' }
  | { t: 'signed-in'; user: AuthUser };

export type SsoProvider = 'google' | 'apple';
export type AuthIntent = 'login' | 'signup';

export type SendCodeResult =
  /** `autoCode`: local backends return the code so dev logins are one click. */
  | { t: 'code-sent'; autoCode?: string }
  /** This address signs in with a password; ask for it and send again. */
  | { t: 'password-required' }
  /** A password login finished without a code. */
  | { t: 'signed-in' }
  /** The address belongs to an SSO domain; the page is navigating there. */
  | { t: 'redirected' }
  | { t: 'failed'; message: string };

export type VerifyCodeResult =
  | { t: 'verified' }
  | { t: 'invalid-code' }
  | { t: 'failed' };

type AuthEventName =
  | 'login'
  | 'sign_up_click'
  | 'mobile_web_welcome_viewed'
  | 'mobile_web_signup_sent_viewed'
  | 'login_from_onboarding';
type TrackAuth = <E extends AuthEventName>(
  event: E,
  data?: E extends keyof AppEvents ? AppEvents[E] : Record<string, unknown>
) => void;

/** Everything sign-in and sign-up need from the app. */
export type AuthContext = {
  session: Accessor<AuthSession>;
  /** Leaves for the identity provider; on web the page navigates away. */
  startSso(provider: SsoProvider, intent: AuthIntent): Promise<void>;
  sendEmailCode(input: {
    email: string;
    password?: string;
  }): Promise<SendCodeResult>;
  verifyEmailCode(input: {
    email: string;
    code: string;
  }): Promise<VerifyCodeResult>;
  /** Exchanges the auth service's return-URL code for session cookies. */
  redeemSessionToken(token: string): Promise<boolean>;
  /** Refreshes everything that depends on who is signed in. */
  completeLogin(): Promise<void>;
  sendMobileWelcomeEmail(email: string): Promise<MobileWelcomeResult>;
  identify(user: { id: string; email: string | undefined }): void;
  /** Ad conversions for a mobile-web lead, deduplicated by email. */
  trackMobileSignupLead(email: string): void;
  pageView(name: 'login' | 'signup'): void;
  track: TrackAuth;
  notifyFailure(message: string): void;
};

const Context = createContext<AuthContext>();

export const AuthProvider = Context.Provider;

export function useAuthContext(): AuthContext {
  const context = useContext(Context);
  if (!context) throw new Error('AuthProvider is required');
  return context;
}
