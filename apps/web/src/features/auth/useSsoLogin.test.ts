import type { RedirectLocation } from '@core/util/authRedirect';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  nativeMobile: false,
  servers: { 'auth-service': '' },
  location: { state: undefined as RedirectLocation | undefined },
  track: vi.fn(),
  createNativeAuthSession: vi.fn(),
  authenticate: vi.fn(),
  sessionLogin: vi.fn(),
  unsetTokenPromise: vi.fn(),
  invalidateAllAfterLogin: vi.fn(),
  initEmailLink: vi.fn(),
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
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
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
