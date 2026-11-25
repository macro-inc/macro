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
  signOuts: 0,
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));

vi.mock('@core/auth/logout', () => ({
  endSessionInPlace: () =>
    new Promise<boolean>((resolve) => {
      mocks.signOuts += 1;
      mocks.endSession = resolve;
    }),
}));

vi.mock('./create-app-auth-context', async () => {
  const { createFakeAuth } = await import('./tests/fake-auth-context');
  return { createAppAuthContext: () => createFakeAuth().context };
});

// The real handoff storage, with the views it would show stubbed.
vi.mock('@app/features/onboarding/onboarding', async (original) => {
  const actual =
    await original<typeof import('@app/features/onboarding/onboarding')>();
  return {
    OnboardingSignup: () => <p>Sign-up slides</p>,
    OnboardingPending: () => <p>Signing out</p>,
    Onboarding: () => null,
    OnboardingAppHandoff: () => null,
    clearSignupDraft: () => {},
    rememberAppHandoff: actual.rememberAppHandoff,
    appHandoffAwaitingSignOut: actual.appHandoffAwaitingSignOut,
    finishAppHandoffSignOut: actual.finishAppHandoffSignOut,
    pendingAppHandoff: actual.pendingAppHandoff,
  };
});

const { pendingAppHandoff } = await import(
  '@app/features/onboarding/onboarding'
);

vi.mock('@solidjs/router', async (original) => ({
  ...(await original<typeof import('@solidjs/router')>()),
  useSearchParams: () => [mocks.params, mocks.setParams],
  useNavigate: () => vi.fn(),
}));

beforeEach(() => {
  stubOnboardingBrowser();
  sessionStorage.clear();
  vi.clearAllMocks();
  mocks.endSession = undefined;
  mocks.signOuts = 0;
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
    // Not before the old session has ended.
    expect(pendingAppHandoff()).toBeUndefined();

    mocks.endSession?.(true);
    await screen.findByText('Sign-up slides');
    expect(pendingAppHandoff()).toMatchObject({
      challenge: CHALLENGE,
      handoffId: HANDOFF_ID,
      signedOut: true,
    });
  });

  it('hands nothing to the app when the old session could not be ended', async () => {
    render(() => <Login signupMode />);
    mocks.endSession?.(false);
    await screen.findByText('Sign-up slides');
    expect(pendingAppHandoff()).toBeUndefined();
  });

  it('signs out again after a reload that cut the sign-out short', async () => {
    const first = render(() => <Login signupMode />);
    first.unmount();
    // The reloaded page has no parameters left.
    mocks.params = {};
    render(() => <Login signupMode />);
    expect(screen.getByText('Signing out')).toBeTruthy();
    expect(mocks.signOuts).toBe(2);
    expect(pendingAppHandoff()).toBeUndefined();

    mocks.endSession?.(true);
    await screen.findByText('Sign-up slides');
    expect(pendingAppHandoff()?.signedOut).toBe(true);
  });

  it('is only taken from sign-up, not sign-in', async () => {
    render(() => <Login />);
    await screen.findByRole('button', { name: 'Continue with Google' });
    expect(mocks.signOuts).toBe(0);
    expect(mocks.setParams).not.toHaveBeenCalled();
  });
});
