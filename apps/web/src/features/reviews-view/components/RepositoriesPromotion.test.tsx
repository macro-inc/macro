import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoriesPromotion } from './RepositoriesPromotion';

const host = vi.hoisted(() => ({
  status: 'linked' as string,
  pending: false,
  authorize: vi.fn(async () => false),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@queries/prompt-dismissals', () => ({
  usePromptDismissalsQuery: () => ({
    isSuccess: true,
    isError: false,
    data: { dismissed: [] },
  }),
  dismissPromptEverywhere: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@core/auth/authorize-github', () => ({
  authorizeGithub: host.authorize,
}));
vi.mock('@queries/auth', () => ({
  useGithubLinkStatusQuery: () => ({
    get isPending() {
      return host.pending;
    },
    get data() {
      return { status: host.status };
    },
  }),
  useInitGithubLinkMutation: () => ({ mutateAsync: vi.fn() }),
  useReauthenticateGithubMutation: () => ({ mutateAsync: vi.fn() }),
}));

beforeEach(() => {
  host.status = 'linked';
  host.pending = false;
  host.authorize.mockClear();
  vi.stubGlobal('open', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('RepositoriesPromotion', () => {
  it('opens the GitHub App install page once GitHub is linked', () => {
    render(() => <RepositoriesPromotion />);
    fireEvent.click(screen.getByRole('button', { name: 'Add repositories' }));
    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining('/github/install-sync'),
      '_blank',
      'noopener'
    );
  });

  it('links the GitHub account first when none is connected', () => {
    host.status = 'unlinked';
    render(() => <RepositoriesPromotion />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    expect(host.authorize).toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    host.status = 'linked';
  });

  it('reconnects an expired GitHub link instead of opening the install page', () => {
    host.status = 'reauthentication_required';
    render(() => <RepositoriesPromotion />);
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect GitHub' }));
    expect(host.authorize).toHaveBeenCalledWith(
      expect.any(Function),
      'Failed to reconnect GitHub'
    );
    expect(window.open).not.toHaveBeenCalled();
    host.status = 'linked';
  });

  it('renders the last known GitHub status at once while it reloads', () => {
    const view = render(() => <RepositoriesPromotion />);
    expect(
      screen.getByRole('button', { name: 'Add repositories' })
    ).toBeTruthy();
    view.unmount();
    host.pending = true;
    render(() => <RepositoriesPromotion />);
    expect(
      screen.getByRole('button', { name: 'Add repositories' })
    ).toBeTruthy();
  });

  it('shows nothing while GitHub status loads on a first visit', () => {
    host.pending = true;
    render(() => <RepositoriesPromotion />);
    expect(screen.queryByRole('button', { name: 'Connect GitHub' })).toBeNull();
  });
});
