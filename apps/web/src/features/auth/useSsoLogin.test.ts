import type { RedirectLocation } from '@core/util/authRedirect';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  nativeMobile: false,
  platform: 'web' as 'web' | 'desktop' | 'ios' | 'android',
  servers: { 'auth-service': '' },
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
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: mocks.track }),
}));
vi.mock('@solidjs/router', () => ({ useLocation: () => mocks.location }));
vi.mock('@core/constant/servers', () => ({ SERVER_HOSTS: mocks.servers }));
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
vi.mock('@queries/auth/user-info', () => ({
  invalidateAllAfterLogin: mocks.invalidateAllAfterLogin,
}));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { sessionLogin: mocks.sessionLogin },
}));

import { useSsoLogin } from './useSsoLogin';

const loginUrl = 'https://localhost:3003/app/login?referral_code=invite';
const proxyAuthHost = 'https://localhost:3003/__macro_dev/gateway/auth';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('window', {
    location: { href: loginUrl, origin: new URL(loginUrl).origin },
  });
  mocks.nativeMobile = false;
  mocks.platform = 'web';
  mocks.openDesktopAuthSession.mockResolvedValue({ success: true });
  mocks.servers['auth-service'] = proxyAuthHost;
  mocks.location.state = undefined;
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

describe('useSsoLogin', () => {
  it.each([
    { host: proxyAuthHost, mobile: 'true' },
    { host: 'https://gateway.macro.com/auth', mobile: null },
  ])('redirects browser SSO through $host', async ({ host, mobile }) => {
    mocks.servers['auth-service'] = host;

    await useSsoLogin()('google');

    const redirect = new URL(window.location.href);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(`${host}/login/sso`);
    expect(redirect.searchParams.get('is_mobile')).toBe(mobile);
    expect(redirect.searchParams.get('original_url')).toBe(loginUrl);
    expect(redirect.searchParams.get('referral_code')).toBe('invite');
    expect(redirect.searchParams.get('idp_name')).toBe('google');
    expect(mocks.createNativeAuthSession).not.toHaveBeenCalled();
    expect(mocks.sessionLogin).not.toHaveBeenCalled();
    expect(mocks.track).toHaveBeenCalledWith('login', { method: 'google' }, [
      'posthog',
    ]);
  });

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
    expect(redirect.searchParams.get('original_url')).toBe(
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
  it.each([proxyAuthHost, 'https://gateway.macro.com/auth'])(
    'sends desktop SSO to the system browser with a deep-link callback through %s',
    async (host) => {
      mocks.platform = 'desktop';
      mocks.servers['auth-service'] = host;

      await useSsoLogin()('google');

      const authUrl = new URL(mocks.openDesktopAuthSession.mock.calls[0][0]);
      expect(`${authUrl.origin}${authUrl.pathname}`).toBe(`${host}/login/sso`);
      expect(authUrl.searchParams.get('original_url')).toBe('macro:///login');
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
    expect(authUrl.searchParams.get('original_url')).toBe('macro:///login');
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

  it.each([proxyAuthHost, 'https://gateway.macro.com/auth'])(
    'uses native authentication and redeems the session code through %s',
    async (host) => {
      mocks.nativeMobile = true;
      mocks.servers['auth-service'] = host;

      await useSsoLogin()('google');

      expect(mocks.createNativeAuthSession).toHaveBeenCalledWith('login');
      const authUrl = new URL(mocks.authenticate.mock.calls[0][0]);
      expect(authUrl.searchParams.get('is_mobile')).toBe('true');
      expect(authUrl.searchParams.get('original_url')).toBe(
        'macro://android-auth/test-attempt'
      );
      expect(mocks.sessionLogin).toHaveBeenCalledWith({
        session_code: 'session-code',
      });
      expect(mocks.unsetTokenPromise).toHaveBeenCalledOnce();
      expect(mocks.invalidateAllAfterLogin).toHaveBeenCalledOnce();
      expect(mocks.initEmailLink).toHaveBeenCalledOnce();
      expect(window.location.href).toBe(loginUrl);
    }
  );
});
