/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeInviteCode } from '../channel-invitations/core/invite-code';

const mocks = vi.hoisted(() => ({
  redirect: undefined as string | undefined,
  tutorialComplete: false,
  navigate: vi.fn(),
}));
vi.mock('@solidjs/router', () => ({
  action: (fn: unknown) => fn,
  useAction: () => vi.fn(),
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [
    {
      get redirect() {
        return mocks.redirect;
      },
    },
  ],
  useSubmission: () => ({}),
}));
vi.mock('@queries/auth', () => ({
  useUserInfo: () => () => ({
    authenticated: true,
    id: 'macro|guest@example.com',
    email: 'guest@example.com',
  }),
}));
vi.mock('@queries/auth/user-info', () => ({
  useUserInfoQuery: () => ({
    data: { authenticated: true, tutorialComplete: mocks.tutorialComplete },
  }),
  invalidateAllAfterLogin: vi.fn(),
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({
    pageView: vi.fn(),
    identify: vi.fn(),
    track: vi.fn(),
  }),
}));
vi.mock('@app/features/setup/flow/useOnboardingV4Flag', () => ({
  useOnboardingV4Flag: () => () => ({ enabled: true, loading: false }),
}));
vi.mock('@app/features/setup/flow/OnboardingFlow', () => ({
  OnboardingFlow: () => <div>Onboarding</div>,
}));
vi.mock('@app/features/setup/flow/shared', () => ({
  NoiseBackground: () => null,
}));
vi.mock('@core/email-link', () => ({
  useEmailLinks: () => ({ initEmailLink: vi.fn() }),
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => false,
}));
vi.mock('./EmailForm', () => ({
  autoLoginCode: () => undefined,
  sendEmailCode: vi.fn(),
  sentEmailCode: () => undefined,
  useResetEmailCode: () => vi.fn(),
}));
vi.mock('./useSsoLogin', () => ({ useSsoLogin: () => vi.fn() }));

import { Login } from './Login';

afterEach(cleanup);
beforeEach(() => {
  mocks.redirect = undefined;
  mocks.tutorialComplete = false;
  mocks.navigate.mockReset();
});

describe('channel invitation login handoff', () => {
  it('returns new accounts to the invitation before onboarding', async () => {
    const code = encodeInviteCode('ffeeddcc-bbaa-4988-b766-554433221100');
    mocks.redirect = `/app/c/${code}`;
    render(() => <Login />);
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith(`/c/${code}`, {
        replace: true,
      })
    );
    expect(screen.queryByText('Onboarding')).toBeNull();
  });
  it('retains onboarding for other new accounts', () => {
    mocks.redirect = 'https://evil.example';
    render(() => <Login />);
    expect(screen.getByText('Onboarding')).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it('returns existing accounts home for an untrusted redirect', async () => {
    mocks.tutorialComplete = true;
    mocks.redirect = '//evil.example';
    render(() => <Login />);
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true })
    );
  });
});
