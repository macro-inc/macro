import { stubOnboardingBrowser } from '@app/features/onboarding/tests/render';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Login } from './auth';

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const HANDOFF_ID = '01938f2e-7c4a-7b3e-9a51-2f6d8c0e4b17';

const mocks = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  setParams: vi.fn(),
  endSession: undefined as ((ended: boolean) => void) | undefined,
  forgetAppHandoff: vi.fn(),
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));

vi.mock('@core/auth/logout', () => ({
  endSessionInPlace: () =>
    new Promise<boolean>((resolve) => {
      mocks.endSession = resolve;
    }),
}));

vi.mock('./create-app-auth-context', async () => {
  const { createFakeAuth } = await import('./tests/fake-auth-context');
  return { createAppAuthContext: () => createFakeAuth().context };
});

// The real handoff parsing, with the views it would show stubbed.
vi.mock('@app/features/onboarding/onboarding', async () => {
  const { appHandoffFromParams } = await import(
    '@app/features/onboarding/core/app-handoff'
  );
  return {
    OnboardingSignup: () => <p>Sign-up slides</p>,
    OnboardingPending: () => <p>Signing out</p>,
    Onboarding: () => null,
    OnboardingAppHandoff: () => null,
    clearSignupDraft: () => {},
    rememberAppHandoff: (params: Record<string, unknown>) =>
      appHandoffFromParams(params, Date.now()) !== undefined,
    forgetAppHandoff: mocks.forgetAppHandoff,
    pendingAppHandoff: () => undefined,
  };
});

vi.mock('@solidjs/router', async (original) => ({
  ...(await original<typeof import('@solidjs/router')>()),
  useSearchParams: () => [mocks.params, mocks.setParams],
  useNavigate: () => vi.fn(),
}));

beforeEach(() => {
  stubOnboardingBrowser();
  vi.clearAllMocks();
  mocks.endSession = undefined;
  mocks.params = { app_challenge: CHALLENGE, app_handoff: HANDOFF_ID };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a sign-up the native app opened', () => {
  it('starts signed out, so no account the browser held reaches the app', async () => {
    render(() => <Login signupMode />);
    expect(screen.getByText('Signing out')).toBeTruthy();
    expect(screen.queryByText('Sign-up slides')).toBeNull();
    // The link's parameters go, so a reload mid-sign-up keeps the new session.
    expect(mocks.setParams).toHaveBeenCalledWith(
      { app_challenge: undefined, app_handoff: undefined },
      { replace: true }
    );

    mocks.endSession?.(true);
    await screen.findByText('Sign-up slides');
    expect(mocks.forgetAppHandoff).not.toHaveBeenCalled();
  });

  it('hands nothing to the app when the old session could not be ended', async () => {
    render(() => <Login signupMode />);
    mocks.endSession?.(false);
    await screen.findByText('Sign-up slides');
    expect(mocks.forgetAppHandoff).toHaveBeenCalledTimes(1);
  });

  it('is only taken from sign-up, not sign-in', async () => {
    render(() => <Login />);
    await screen.findByRole('button', { name: 'Continue with Google' });
    expect(mocks.endSession).toBeUndefined();
    expect(mocks.setParams).not.toHaveBeenCalled();
  });
});
