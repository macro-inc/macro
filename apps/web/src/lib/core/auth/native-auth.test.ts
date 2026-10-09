import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock('@core/util/platform', () => ({
  getNativeMobilePlatform: mocks.platform,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

import {
  createNativeAuthSession,
  DESKTOP_AUTH_CALLBACK_URL,
  openDesktopAuthSession,
} from './native-auth';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.platform.mockReturnValue('android');
});

describe('native browser authentication', () => {
  it('binds each Android attempt to a distinct callback before starting OAuth', async () => {
    const first = createNativeAuthSession('login');
    const second = createNativeAuthSession('login');
    expect(first.callbackUrl).toMatch(/^macro:\/\/android-auth\/[\da-f-]{36}$/);
    expect(second.callbackUrl).not.toBe(first.callbackUrl);
    mocks.invoke.mockResolvedValue({ success: true, token: 'one-time-code' });
    await expect(
      first.authenticate('https://gateway.macro.com/auth/login/sso')
    ).resolves.toEqual({
      success: true,
      token: 'one-time-code',
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      'plugin:android-auth|authenticate',
      {
        payload: {
          authUrl: 'https://gateway.macro.com/auth/login/sso',
          callbackUrl: first.callbackUrl,
        },
      }
    );
  });

  it('preserves the iOS plugin contract', async () => {
    mocks.platform.mockReturnValue('ios');
    const session = createNativeAuthSession('inbox-link-callback');
    expect(session.callbackUrl).toBe('macro://inbox-link-callback');
    await session.authenticate('https://accounts.google.com/authorize');
    expect(mocks.invoke).toHaveBeenCalledWith('plugin:auth|authenticate', {
      payload: {
        authUrl: 'https://accounts.google.com/authorize',
        callbackScheme: 'macro',
        ephemeralSession: true,
      },
    });
  });

  it('settles bridge errors and preserves user cancellation', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('bridge unavailable'));
    const session = createNativeAuthSession('login');
    await expect(session.authenticate('https://example.com')).resolves.toEqual({
      success: false,
      error: 'Unable to start authentication',
    });
    mocks.invoke.mockResolvedValueOnce({
      success: false,
      error: 'User canceled login',
    });
    await expect(session.authenticate('https://example.com')).resolves.toEqual({
      success: false,
      error: 'User canceled login',
    });
  });

  it('hands the desktop flow to the system browser', async () => {
    mocks.invoke.mockResolvedValue(undefined);
    await expect(
      openDesktopAuthSession('https://gateway.macro.com/auth/login/sso')
    ).resolves.toEqual({ success: true });
    expect(mocks.invoke).toHaveBeenCalledWith('plugin:opener|open_url', {
      url: 'https://gateway.macro.com/auth/login/sso',
    });
  });

  it('settles a desktop browser that will not open', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('no opener'));
    await expect(
      openDesktopAuthSession('https://gateway.macro.com/auth/login/sso')
    ).resolves.toEqual({
      success: false,
      error: 'Unable to start authentication',
    });
  });

  // The deep-link bridge maps this to a `/login` router navigation, and only
  // an empty host parses that way — `macro://login` would arrive as a host.
  it('points the desktop callback at a route that redeems a session code', () => {
    const callback = new URL(DESKTOP_AUTH_CALLBACK_URL);
    expect(callback.protocol).toBe('macro:');
    expect(callback.host).toBe('');
    expect(callback.pathname).toBe('/login');
  });

  it('accepts account-link callbacks without a login session token', async () => {
    mocks.invoke.mockResolvedValue({ success: true });
    await expect(
      createNativeAuthSession('github-link-callback').authenticate(
        'https://github.com/login/oauth/authorize'
      )
    ).resolves.toEqual({ success: true });
  });
});
