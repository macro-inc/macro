import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  desktop: vi.fn(),
  mobile: vi.fn(),
  invoke: vi.fn(),
  invalidate: vi.fn(),
  failure: vi.fn(),
}));
vi.mock('@core/util/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/util/platform')>()),
  isDesktopPlatform: mocks.desktop,
}));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: mocks.mobile,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@queries/auth', () => ({
  invalidateGithubLinkStatus: mocks.invalidate,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));

import {
  authorizeGithub,
  GITHUB_LINK_CALLBACK_PATH,
  handleGithubLinkCallback,
} from './authorize-github';

const AUTHORIZATION_URL = 'https://github.com/login/oauth/authorize?state=s';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.desktop.mockReturnValue(true);
  mocks.mobile.mockReturnValue(false);
  mocks.invalidate.mockResolvedValue(undefined);
});

describe('desktop GitHub authorization', () => {
  it('returns through the macro deep link and opens consent in the system browser', async () => {
    const getAuthorizationUrl = vi.fn().mockResolvedValue(AUTHORIZATION_URL);
    mocks.invoke.mockResolvedValue(undefined);

    await expect(
      authorizeGithub(getAuthorizationUrl, 'Failed to connect GitHub')
    ).resolves.toBe(false);

    expect(getAuthorizationUrl).toHaveBeenCalledWith(
      'macro:///github-link-callback'
    );
    expect(mocks.invoke).toHaveBeenCalledWith('plugin:opener|open_url', {
      url: AUTHORIZATION_URL,
    });
    expect(mocks.failure).not.toHaveBeenCalled();
  });

  it('reports a browser that fails to open', async () => {
    mocks.invoke.mockRejectedValue(new Error('no opener'));

    await authorizeGithub(
      async () => AUTHORIZATION_URL,
      'Failed to connect GitHub'
    );

    expect(mocks.failure).toHaveBeenCalledWith('Failed to connect GitHub');
  });

  it('consumes the callback and refreshes the link status', () => {
    expect(handleGithubLinkCallback('/settings/connections')).toBe(false);
    expect(mocks.invalidate).not.toHaveBeenCalled();

    expect(handleGithubLinkCallback(GITHUB_LINK_CALLBACK_PATH)).toBe(true);
    expect(mocks.invalidate).toHaveBeenCalledOnce();
  });
});
