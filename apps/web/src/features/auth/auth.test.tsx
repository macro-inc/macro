import { saveSignupDraft } from '@app/features/onboarding/primitives/flow-storage';
import { stubOnboardingBrowser } from '@app/features/onboarding/tests/render';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Login } from './auth';
import type { createFakeAuth } from './tests/fake-auth-context';

const world = vi.hoisted(() => ({
  microsoftSignup: false,
  auth: undefined as ReturnType<typeof createFakeAuth> | undefined,
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled: flag.key === 'enable-microsoft-signup' && world.microsoftSignup,
  }),
}));

// Provider sign-in leaves the page; the fake never comes back signed in.
vi.mock('./create-app-auth-context', async () => {
  const { createFakeAuth } = await import('./tests/fake-auth-context');
  return {
    createAppAuthContext: () => {
      world.auth = createFakeAuth(
        {},
        { ssoRedirect: () => new Promise(() => {}) }
      );
      return world.auth.context;
    },
  };
});

// The real sign-up slides, on a fake onboarding backend.
vi.mock('@app/features/onboarding/onboarding', async () => {
  const { OnboardingProvider } = await import(
    '@app/features/onboarding/context/onboarding-context'
  );
  const { createFakeOnboarding } = await import(
    '@app/features/onboarding/tests/fake-onboarding-context'
  );
  const { SignupJourneyView } = await import(
    '@app/features/onboarding/views/signup-journey-view'
  );
  return {
    OnboardingSignup: (props: Parameters<typeof SignupJourneyView>[0]) => (
      <OnboardingProvider
        value={createFakeOnboarding({ viewer: null }).context}
      >
        <SignupJourneyView {...props} />
      </OnboardingProvider>
    ),
    OnboardingPending: () => null,
    Onboarding: () => null,
    clearSignupDraft: () => {},
  };
});

vi.mock('@solidjs/router', async (original) => ({
  ...(await original<typeof import('@solidjs/router')>()),
  useSearchParams: () => [{}, vi.fn()],
  useNavigate: () => vi.fn(),
}));

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  stubOnboardingBrowser();
  world.microsoftSignup = false;
  world.auth = undefined;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const microsoftButton = () =>
  screen.queryByRole('button', { name: 'Continue with Microsoft' });

describe('Continue with Microsoft, behind enable-microsoft-signup', () => {
  it('is not offered on sign-in while the flag is off', async () => {
    render(() => <Login />);
    await screen.findByRole('button', { name: 'Continue with Google' });
    expect(microsoftButton()).toBeNull();
  });

  it('signs in through Microsoft once the flag is on', async () => {
    world.microsoftSignup = true;
    render(() => <Login />);
    await screen.findByRole('button', { name: 'Continue with Google' });
    const microsoft = microsoftButton();
    expect(microsoft).toBeTruthy();
    if (microsoft) fireEvent.click(microsoft);
    await waitFor(() =>
      expect(world.auth?.calls()).toContain('sso:microsoft:login')
    );
  });

  it('keeps the sign-up work step Google-only, with its old copy, while the flag is off', async () => {
    saveSignupDraft({ step: 'work' });
    render(() => <Login signupMode />);
    await screen.findByRole('button', { name: 'Connect work email' });
    expect(
      screen.getByRole('heading', { name: /Connect your work/ })
    ).toBeTruthy();
    expect(microsoftButton()).toBeNull();
    expect(screen.queryByText('Continuing with Microsoft')).toBeNull();
    expect(screen.getByText('Google account connection')).toBeTruthy();
  });

  it('offers Microsoft sign-up and explains it under Read more once the flag is on', async () => {
    world.microsoftSignup = true;
    saveSignupDraft({ step: 'work' });
    render(() => <Login signupMode />);
    await screen.findByRole('button', { name: 'Continue with Google' });
    expect(
      screen.getByRole('heading', { name: /Continue with your work/ })
    ).toBeTruthy();
    expect(screen.getByText('Continuing with Microsoft')).toBeTruthy();
    const microsoft = microsoftButton();
    expect(microsoft).toBeTruthy();
    if (microsoft) fireEvent.click(microsoft);
    await waitFor(() =>
      expect(world.auth?.calls()).toContain('sso:microsoft:signup')
    );
  });
});
