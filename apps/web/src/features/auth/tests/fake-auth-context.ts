import { createSignal } from 'solid-js';
import { createStore, produce, unwrap } from 'solid-js/store';
import type {
  AuthContext,
  AuthIntent,
  AuthSession,
  AuthUser,
  SsoProvider,
} from '../context/auth-context';
import type { MobileWelcomeResult } from '../core/mobile-welcome';

/** The fake auth backend's state. Plain JSON, so a harness can persist it. */
export type FakeAuthWorld = {
  user: AuthUser | null;
  /** Accounts that exist; an unknown email signs up as a first-time user. */
  accounts: Record<string, { tutorialComplete: boolean }>;
  /** The code the fake mailer "sends". */
  code: string;
  /** Addresses that sign in with a password instead of a code. */
  passwordAccounts: Record<string, string>;
  /** Addresses whose organization signs in through its own identity provider. */
  ssoDomains: string[];
  /** Return the code with the send, like a local backend. */
  autoCode: boolean;
  /** Session tokens the fake auth service will redeem, keyed to an email. */
  sessionTokens: Record<string, string>;
  /** Pending email login across a page reload. */
  pendingEmail: string | undefined;
  mobileWelcome: MobileWelcomeResult['t'];
  failures: Partial<Record<'sendCode' | 'verify', string>>;
};

export type FakeAuthEvent = { event: string; data: unknown };

export function defaultFakeAuthWorld(): FakeAuthWorld {
  return {
    user: null,
    accounts: { 'returning@acme.com': { tutorialComplete: true } },
    code: '424242',
    passwordAccounts: {},
    ssoDomains: [],
    autoCode: false,
    sessionTokens: {},
    pendingEmail: undefined,
    mobileWelcome: 'sent',
    failures: {},
  };
}

const userFor = (
  email: string,
  account: { tutorialComplete: boolean } | undefined
): AuthUser => ({
  id: `macro|${email}`,
  email,
  tutorialComplete: account?.tutorialComplete ?? false,
});

/**
 * An in-memory auth backend behind the real contract. `ssoRedirect` models
 * leaving for the identity provider; without it, SSO signs in immediately.
 */
export function createFakeAuth(
  overrides: Partial<FakeAuthWorld> = {},
  options: {
    onChange?: (world: FakeAuthWorld) => void;
    /** Who Google/Apple sign in as. */
    ssoEmail?: string;
    ssoRedirect?: (
      provider: SsoProvider,
      intent: AuthIntent,
      email: string
    ) => Promise<void>;
    /** Report the session as loading this long, like a cold page load. */
    sessionLatencyMs?: number;
  } = {}
) {
  const [world, setWorld] = createStore<FakeAuthWorld>({
    ...defaultFakeAuthWorld(),
    ...overrides,
  });
  const [events, setEvents] = createSignal<FakeAuthEvent[]>([]);
  const [notifications, setNotifications] = createSignal<string[]>([]);
  const [calls, setCalls] = createSignal<string[]>([]);
  const call = (name: string) => setCalls((list) => [...list, name]);

  const update = (change: (draft: FakeAuthWorld) => void) => {
    setWorld(produce(change));
    options.onChange?.(structuredClone(unwrap(world)));
  };
  const signIn = (email: string) =>
    update((draft) => {
      draft.accounts[email] ??= { tutorialComplete: false };
      draft.user = userFor(email, draft.accounts[email]);
      draft.pendingEmail = undefined;
    });

  const [settled, setSettled] = createSignal(!options.sessionLatencyMs);
  if (options.sessionLatencyMs)
    setTimeout(() => setSettled(true), options.sessionLatencyMs);
  const session = (): AuthSession =>
    !settled()
      ? { t: 'loading' }
      : world.user
        ? { t: 'signed-in', user: { ...world.user } }
        : { t: 'signed-out' };

  const context: AuthContext = {
    session,
    startSso: async (provider, intent) => {
      call(`sso:${provider}:${intent}`);
      const email = options.ssoEmail ?? 'new@acme.com';
      if (options.ssoRedirect)
        return options.ssoRedirect(provider, intent, email);
      signIn(email);
    },
    sendEmailCode: async ({ email, password }) => {
      call(`sendCode:${email}`);
      const failure = world.failures.sendCode;
      if (failure !== undefined) return { t: 'failed', message: failure };
      const expected = world.passwordAccounts[email];
      if (expected !== undefined) {
        if (password === undefined) return { t: 'password-required' };
        if (password !== expected)
          return {
            t: 'failed',
            message:
              'Failed to login. Check your email and password then try again.',
          };
        signIn(email);
        return { t: 'signed-in' };
      }
      if (world.ssoDomains.some((domain) => email.endsWith(`@${domain}`)))
        return { t: 'redirected' };
      update((draft) => {
        draft.pendingEmail = email;
      });
      return world.autoCode
        ? { t: 'code-sent', autoCode: world.code }
        : { t: 'code-sent' };
    },
    verifyEmailCode: async ({ email, code }) => {
      call(`verify:${email}:${code}`);
      if (world.failures.verify !== undefined) return { t: 'failed' };
      if (code !== world.code) return { t: 'invalid-code' };
      signIn(email);
      return { t: 'verified' };
    },
    redeemSessionToken: async (token) => {
      call(`redeem:${token}`);
      const email = world.sessionTokens[token];
      if (!email) return false;
      signIn(email);
      return true;
    },
    completeLogin: async () => {
      call('completeLogin');
    },
    sendMobileWelcomeEmail: async (email) => {
      call(`mobileWelcome:${email}`);
      const outcome = world.mobileWelcome;
      return outcome === 'sent'
        ? { t: 'sent', alreadySent: false }
        : { t: outcome };
    },
    identify: (user) => call(`identify:${user.id}`),
    trackMobileSignupLead: (email) => call(`lead:${email}`),
    pageView: (name) => call(`pageView:${name}`),
    track: (event, data) => setEvents((list) => [...list, { event, data }]),
    notifyFailure: (message) => setNotifications((list) => [...list, message]),
  };

  return { context, world, update, events, notifications, calls };
}
