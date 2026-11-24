/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubConnectPage } from './github-connect-page';

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  link: vi.fn(),
  navigate: vi.fn(),
  desktop: false,
}));

vi.mock('@queries/auth/github-link', () => ({
  readGithubLinkStatus: mocks.status,
  useGithubLinkStatusQuery: () => ({ isSuccess: false }),
}));
vi.mock('@core/auth/authorize-github', () => ({
  linkGithubAccount: mocks.link,
}));
vi.mock('@core/util/platform', () => ({
  isDesktopPlatform: () => mocks.desktop,
}));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => false,
}));
vi.mock('@solidjs/router', () => ({ useNavigate: () => mocks.navigate }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.desktop = false;
  sessionStorage.clear();
  mocks.link.mockResolvedValue(false);
});
afterEach(cleanup);

describe('the GitHub connect page', () => {
  it('starts the account link when the account is not linked', async () => {
    mocks.status.mockResolvedValue('unlinked');
    render(() => <GithubConnectPage />);
    await vi.waitFor(() => expect(mocks.link).toHaveBeenCalledOnce());
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('relinks an account whose token stopped working', async () => {
    mocks.status.mockResolvedValue('reauthentication_required');
    render(() => <GithubConnectPage />);
    await vi.waitFor(() => expect(mocks.link).toHaveBeenCalledOnce());
  });

  it('returns to Integrations once the account is linked', async () => {
    mocks.status.mockResolvedValue('linked');
    render(() => <GithubConnectPage />);
    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith('/settings/connections', {
        replace: true,
      })
    );
    expect(mocks.link).not.toHaveBeenCalled();
  });

  it('offers a retry, never a loop, after GitHub returns without a link', async () => {
    mocks.status.mockResolvedValue('unlinked');
    sessionStorage.setItem('github-connect-started', '1');
    render(() => <GithubConnectPage />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(mocks.link).not.toHaveBeenCalled();
  });

  it('waits for the system browser in the desktop app', async () => {
    mocks.desktop = true;
    mocks.status.mockResolvedValue('unlinked');
    render(() => <GithubConnectPage />);
    expect(
      await screen.findByText('Finish connecting GitHub in your browser.')
    ).toBeTruthy();
  });
});
