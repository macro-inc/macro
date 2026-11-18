import type { RedirectLocation } from '@core/util/authRedirect';
import { err, ok, ResultAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  nativeMobile: false,
  platform: 'web' as 'web' | 'desktop' | 'ios' | 'android',
  servers: { 'auth-service': '' },
  localStackProxy: false,
  location: { state: undefined as RedirectLocation | undefined },
  track: vi.fn(),
  createNativeAuthSession: vi.fn(),
  openDesktopAuthSession: vi.fn(),
  authenticate: vi.fn(),
  sessionLogin: vi.fn(),
  unsetTokenPromise: vi.fn(),
  invalidateAllAfterLogin: vi.fn(),
  initEmailLink: vi.fn(),
  setPostLoginRedirect: vi.fn(),
  toastFailure: vi.fn(),
  syncLoginStorage: vi.fn(),
  reloadHolds: 0,
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: mocks.track }),
}));
vi.mock('@solidjs/router', () => ({ useLocation: () => mocks.location }));
vi.mock('@core/constant/servers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/servers')>()),
  SERVER_HOSTS: mocks.servers,
  usesLocalStackProxy: () => mocks.localStackProxy,
}));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => mocks.nativeMobile,
}));
vi.mock('@core/auth/native-auth', () => ({
  createNativeAuthSession: mocks.createNativeAuthSession,
  openDesktopAuthSession: mocks.openDesktopAuthSession,
  DESKTOP_AUTH_CALLBACK_URL: 'macro:///login',
}));
vi.mock('@core/util/platform', () => ({
  isPlatform: (target: string) => mocks.platform === target,
}));
vi.mock('@core/util/postLoginRedirect', () => ({
  setPostLoginRedirect: mocks.setPostLoginRedirect,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.toastFailure },
}));
vi.mock('@core/email-link', () => ({
  useEmailLinks: () => ({ initEmailLink: mocks.initEmailLink }),
}));
vi.mock('@core/util/fetchWithToken', () => ({
  unsetTokenPromise: mocks.unsetTokenPromise,
}));
vi.mock('@core/util/cookies', () => ({
  syncLoginStorage: mocks.syncLoginStorage,
}));
vi.mock('@core/util/reloadForNewerBuild', () => ({
  holdAutomaticReload: () => {
    mocks.reloadHolds++;
    return () => {
      mocks.reloadHolds--;
    };
  },
}));
vi.mock('@queries/auth/user-info', () => ({
  invalidateAllAfterLogin: mocks.invalidateAllAfterLogin,
}));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { sessionLogin: mocks.sessionLogin },
}));

import { signInChallenge, takeSignInAttempt } from '@core/auth/sign-in-attempt';
import { useSsoLogin } from './useSsoLogin';

const loginUrl = 'https://localhost:3003/app/login?referral_code=invite';
const proxyAuthHost = 'https://localhost:3003/__macro_dev/gateway/auth';

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.stubGlobal('window', {
    location: { href: loginUrl, origin: new URL(loginUrl).origin },
  });
  mocks.nativeMobile = false;
  mocks.platform = 'web';
  mocks.openDesktopAuthSession.mockResolvedValue({ success: true });
  mocks.servers['auth-service'] = proxyAuthHost;
  mocks.localStackProxy = false;
  mocks.location.state = undefined;
  mocks.reloadHolds = 0;
  mocks.createNativeAuthSession.mockReturnValue({
    callbackUrl: 'macro://android-auth/test-attempt',
    authenticate: mocks.authenticate,
  });
  mocks.authenticate.mockResolvedValue({
    success: true,
    token: 'session-code',
  });
  mocks.sessionLogin.mockResolvedValue(ok(undefined));
  mocks.initEmailLink.mockReturnValue(ok(undefined));
});

afterEach(() => vi.unstubAllGlobals());

/**
 * The callback `authUrl` returns to, without the attempt it names, after
 * checking that attempt is pending here and is the one `authUrl` binds the
 * session code to.
 */
async function expectBoundCallback(authUrl: URL): Promise<string> {
  const callback = authUrl.searchParams.get('original_url') ?? '';
  const named = /[?&]sign_in_attempt=([^&#]*)/.exec(callback);
  const verifier = takeSignInAttempt(named?.[1])?.verifier;
  if (!named || !verifier) throw new Error('names no pending attempt');
  expect(authUrl.searchParams.get('session_code_challenge')).toBe(
    await signInChallenge(verifier)
  );
  return callback.replace(named[0], '');
}

describe('useSsoLogin', () => {
  // A local stack's callback runs on the auth service's own port, whose
  // cookies its proxy ignores, so it redeems a session code instead.
  it.each([
    { host: proxyAuthHost, localStack: false, handoff: true },
    { host: 'https://localhost:28009/auth', localStack: true, handoff: true },
    {
      host: 'https://gateway.macro.com/auth',
      localStack: false,
      handoff: false,
    },
  ])(
    'redirects browser SSO through $host',
    async ({ host, localStack, handoff }) => {
      mocks.servers['auth-service'] = host;
      mocks.localStackProxy = localStack;

      await useSsoLogin()('google');

      const redirect = new URL(window.location.href);
      expect(`${redirect.origin}${redirect.pathname}`).toBe(
        `${host}/login/sso`
      );
      if (handoff) {
        // The code comes back on the URL, so it must name this attempt.
        expect(redirect.searchParams.get('is_mobile')).toBe('true');
        expect(await expectBoundCallback(redirect)).toBe(loginUrl);
      } else {
        // The hosted callback sets cookies; no code reaches the URL.
        expect(redirect.searchParams.get('is_mobile')).toBeNull();
        expect(redirect.searchParams.get('session_code_challenge')).toBeNull();
        expect(redirect.searchParams.get('original_url')).toBe(loginUrl);
      }
      expect(redirect.searchParams.get('referral_code')).toBe('invite');
      expect(redirect.searchParams.get('idp_name')).toBe('google');
      expect(mocks.createNativeAuthSession).not.toHaveBeenCalled();
      expect(mocks.sessionLogin).not.toHaveBeenCalled();
      expect(mocks.track).toHaveBeenCalledWith('login', { method: 'google' }, [
        'posthog',
      ]);
      // The hosted return sets only HttpOnly cookies; without this hint the
      // returning load never checks identity and shows sign-in again.
      expect(mocks.syncLoginStorage).toHaveBeenCalledWith(true);
    }
  );

  it('preserves the original browser destination through proxy SSO', async () => {
    window.location.href = 'https://localhost:3003/app/login';
    mocks.location.state = {
      originalLocation: {
        state: null,
        key: '',
        query: { referral_code: 'original-invite' },
        pathname: '/app/doc/document-id',
        search: '?referral_code=original-invite',
        hash: '#comment',
      },
    };

    await useSsoLogin({ signupMode: true })('google');

    const redirect = new URL(window.location.href);
    expect(await expectBoundCallback(redirect)).toBe(
      'https://localhost:3003/app/doc/document-id?referral_code=original-invite#comment'
    );
    expect(redirect.searchParams.get('referral_code')).toBe('original-invite');
    expect(mocks.createNativeAuthSession).not.toHaveBeenCalled();
    expect(mocks.track).toHaveBeenCalledWith(
      'sign_up_click',
      { method: 'google' },
      ['posthog']
    );
  });

  // The desktop shell must not depend on the native navigation plugin
  // rewriting this URL: that only happens for navigations it classifies as
  // external, which the development proxy's same-origin auth host is not.
  // A local stack's handoff only adds `is_mobile` to the web flow; the
  // desktop and native shells already redeem a code and must run exactly as
  // they do against hosted services.
  const shellHosts = [
    { host: proxyAuthHost, localStack: false },
    { host: 'https://gateway.macro.com/auth', localStack: false },
    { host: 'https://localhost:28009/auth', localStack: true },
  ];

  it.each(shellHosts)(
    'sends desktop SSO to the system browser with a deep-link callback through $host',
    async ({ host, localStack }) => {
      mocks.platform = 'desktop';
      mocks.servers['auth-service'] = host;
      mocks.localStackProxy = localStack;

      await useSsoLogin()('google');

      const authUrl = new URL(mocks.openDesktopAuthSession.mock.calls[0][0]);
      expect(`${authUrl.origin}${authUrl.pathname}`).toBe(`${host}/login/sso`);
      // Anything can open a `macro://` link: the callback names the attempt.
      expect(await expectBoundCallback(authUrl)).toBe('macro:///login');
      expect(authUrl.searchParams.get('is_mobile')).toBe('true');
      expect(authUrl.searchParams.get('idp_name')).toBe('google');
      expect(authUrl.searchParams.get('referral_code')).toBe('invite');
      // The webview must stay on the SPA; navigating it away is what used to
      // hand the flow to the navigation plugin.
      expect(window.location.href).toBe(loginUrl);
      expect(mocks.createNativeAuthSession).not.toHaveBeenCalled();
      expect(mocks.sessionLogin).not.toHaveBeenCalled();
      expect(mocks.track).toHaveBeenCalledWith('login', { method: 'google' }, [
        'posthog',
      ]);
      // The session-code redemption enables the identity check itself.
      expect(mocks.syncLoginStorage).not.toHaveBeenCalled();
    }
  );

  it('parks the desktop destination for after sign-in', async () => {
    mocks.platform = 'desktop';
    mocks.location.state = {
      originalLocation: {
        state: null,
        key: '',
        query: {},
        pathname: '/doc/document-id',
        search: '?referral_code=original-invite',
        hash: '#comment',
      },
    };

    await useSsoLogin()('google');

    expect(mocks.setPostLoginRedirect).toHaveBeenCalledWith(
      '/doc/document-id?referral_code=original-invite#comment'
    );
    const authUrl = new URL(mocks.openDesktopAuthSession.mock.calls[0][0]);
    expect(await expectBoundCallback(authUrl)).toBe('macro:///login');
  });

  it('keeps an invite redirect on the desktop callback beside the attempt', async () => {
    mocks.platform = 'desktop';
    window.location.href = `${loginUrl}&redirect=%2Fteam-invite%3Flink%3Dx`;

    await useSsoLogin()('google');

    const authUrl = new URL(mocks.openDesktopAuthSession.mock.calls[0][0]);
    // Encoded twice: the auth service decodes `original_url` once more.
    expect(await expectBoundCallback(authUrl)).toBe(
      'macro:///login?redirect=%252Fteam-invite%253Flink%253Dx'
    );
  });

  it('reports a desktop browser that will not open', async () => {
    mocks.platform = 'desktop';
    mocks.openDesktopAuthSession.mockResolvedValue({
      success: false,
      error: 'Unable to start authentication',
    });

    await useSsoLogin()('google');

    expect(mocks.toastFailure).toHaveBeenCalledWith(
      'Sign-in failed. Please try again.'
    );
  });

  // Its callback would find no attempt, so the sign-in could never finish.
  it.each([{ platform: 'desktop' as const }, { platform: 'web' as const }])(
    'starts no $platform sign-in whose attempt storage refuses',
    async ({ platform }) => {
      mocks.platform = platform;
      const setItem = vi
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => {
          throw new DOMException('full', 'QuotaExceededError');
        });

      await useSsoLogin()('google');
      setItem.mockRestore();

      expect(mocks.openDesktopAuthSession).not.toHaveBeenCalled();
      expect(window.location.href).toBe(loginUrl);
      expect(mocks.syncLoginStorage).not.toHaveBeenCalled();
      expect(mocks.toastFailure).toHaveBeenCalledWith(
        'Sign-in failed. Please try again.'
      );
    }
  );
  it.each(shellHosts)(
    'uses native authentication and redeems the session code through $host',
    async ({ host, localStack }) => {
      mocks.nativeMobile = true;
      mocks.servers['auth-service'] = host;
      mocks.localStackProxy = localStack;

      await useSsoLogin()('google');

      expect(mocks.createNativeAuthSession).toHaveBeenCalledOnce();
      expect(mocks.createNativeAuthSession).toHaveBeenCalledWith('login');
      expect(mocks.authenticate).toHaveBeenCalledOnce();
      const authUrl = new URL(mocks.authenticate.mock.calls[0][0]);
      expect(authUrl.searchParams.get('is_mobile')).toBe('true');
      expect(authUrl.searchParams.get('original_url')).toBe(
        'macro://android-auth/test-attempt'
      );
      // The sheet returns the code to this call, which alone holds the
      // verifier; nothing is left pending for a URL to claim.
      expect(mocks.sessionLogin).toHaveBeenCalledOnce();
      const [{ session_code, code_verifier }] =
        mocks.sessionLogin.mock.calls[0];
      expect(session_code).toBe('session-code');
      expect(authUrl.searchParams.get('session_code_challenge')).toBe(
        await signInChallenge(code_verifier)
      );
      expect(localStorage.getItem('pendingSignInAttempts')).toBeNull();
      expect(mocks.unsetTokenPromise).toHaveBeenCalledOnce();
      expect(mocks.invalidateAllAfterLogin).toHaveBeenCalledOnce();
      expect(mocks.initEmailLink).toHaveBeenCalledOnce();
      expect(window.location.href).toBe(loginUrl);
      expect(mocks.syncLoginStorage).toHaveBeenCalledWith(true);
      expect(mocks.track).toHaveBeenCalledWith('login', { method: 'google' }, [
        'posthog',
      ]);
    }
  );

  // An app update reload can land on the native sign-in at any point, not
  // only while the sheet is open. A document that reloads after the session
  // code is redeemed but before the login hint is down never checks identity
  // and shows sign-in over the new session.
  it('holds reloads until the redeemed native session has left the login hint', async () => {
    mocks.nativeMobile = true;
    const heldAt: Record<string, boolean> = {};
    mocks.sessionLogin.mockImplementation(async () => {
      heldAt.redeem = mocks.reloadHolds > 0;
      return ok(undefined);
    });
    mocks.syncLoginStorage.mockImplementation(() => {
      heldAt.hint = mocks.reloadHolds > 0;
    });
    // Record the hold as each later step finishes, not as it starts.
    mocks.invalidateAllAfterLogin.mockImplementation(async () => {
      await Promise.resolve();
      heldAt.refresh = mocks.reloadHolds > 0;
    });
    mocks.initEmailLink.mockImplementation(() =>
      ResultAsync.fromSafePromise(
        (async () => {
          await Promise.resolve();
          heldAt.emailLink = mocks.reloadHolds > 0;
        })()
      )
    );

    await useSsoLogin()('google');

    expect(heldAt).toEqual({
      redeem: true,
      hint: true,
      refresh: true,
      emailLink: true,
    });
    expect(mocks.syncLoginStorage).toHaveBeenCalledWith(true);
    // The identity refetch can take a while; the hint must not wait for it.
    expect(mocks.syncLoginStorage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.invalidateAllAfterLogin.mock.invocationCallOrder[0]
    );
    expect(mocks.reloadHolds).toBe(0);
  });

  it('leaves no login hint when the native session code is not redeemed', async () => {
    mocks.nativeMobile = true;
    mocks.sessionLogin.mockResolvedValue(
      err([{ code: 'HTTP_ERROR', message: 'invalid session code' }])
    );

    await useSsoLogin()('google');

    expect(mocks.syncLoginStorage).not.toHaveBeenCalled();
    expect(mocks.invalidateAllAfterLogin).not.toHaveBeenCalled();
    expect(mocks.toastFailure).toHaveBeenCalledWith(
      'Sign-in failed. Please try again.'
    );
    expect(mocks.reloadHolds).toBe(0);
  });

  it('releases the hold without signing in when the sheet is canceled', async () => {
    mocks.nativeMobile = true;
    mocks.authenticate.mockResolvedValue({
      success: false,
      error: 'User canceled login',
    });

    await useSsoLogin()('google');

    expect(mocks.sessionLogin).not.toHaveBeenCalled();
    expect(mocks.syncLoginStorage).not.toHaveBeenCalled();
    expect(mocks.toastFailure).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.reloadHolds).toBe(0);
  });
});
