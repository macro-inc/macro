import { cleanup, fireEvent, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSignupDraft, saveSignupDraft } from '../primitives/flow-storage';
import {
  renderWithFakeOnboarding,
  stubOnboardingBrowser,
} from '../tests/render';
import { SignupJourneyView } from './signup-journey-view';

vi.mock(import('@core/constant/featureFlags'), async (importOriginal) => ({
  ...(await importOriginal()),
  LOCAL_ONLY: true,
}));

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  stubOnboardingBrowser();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  const google = vi.fn().mockResolvedValue(undefined);
  const microsoft = vi.fn().mockResolvedValue(undefined);
  const signIn = vi.fn();
  renderWithFakeOnboarding(
    () => (
      <SignupJourneyView
        onGoogle={google}
        onMicrosoft={microsoft}
        onBackFromEmail={() => {}}
        onSignIn={signIn}
        onAgentSignup={() => {}}
        showingEmail={false}
      />
    ),
    { viewer: null }
  );
  return { google, microsoft, signIn };
}

describe('sign-up starts before authentication', () => {
  it('walks through color, interests, and security before starting Google signup', () => {
    const { google } = setup();
    expect(
      screen.getByRole('heading', { name: 'Create your workspace' })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Coral' }));
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(
      screen.getByRole('heading', {
        name: 'Which features do you want to try first?',
      })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      screen.getByRole('heading', {
        name: 'A workspace built to earn your trust.',
      })
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /12\.3k GitHub stars/ })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(google).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue with Google' })
    );
    expect(google).toHaveBeenCalledOnce();
    expect(readSignupDraft()).toEqual({
      step: 'work',
      accent: '#f77d67',
      authenticating: true,
      provider: 'google',
    });
  });

  it('skips the local opening slides without bypassing authentication', () => {
    const { google } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Bypass' }));
    expect(readSignupDraft()?.step).toBe('work');
    expect(google).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue with Google' })
    );
    expect(google).toHaveBeenCalledOnce();
    expect(readSignupDraft()?.authenticating).toBe(true);
  });

  it('restores the work-email step after an OAuth return or cancellation', () => {
    saveSignupDraft({ step: 'work', accent: '#65d8ac', authenticating: true });
    const { google } = setup();
    expect(
      screen.queryByRole('heading', { name: 'Create your workspace' })
    ).toBeNull();
    expect(google).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue with Google' })
    );
    expect(google).toHaveBeenCalledOnce();
    expect(readSignupDraft()?.accent).toBe('#65d8ac');
  });

  it('starts Microsoft signup from the work step instead of Google', () => {
    saveSignupDraft({ step: 'work', accent: '#65d8ac', authenticating: false });
    const { google, microsoft } = setup();
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue with Microsoft' })
    );
    expect(microsoft).toHaveBeenCalledOnce();
    expect(google).not.toHaveBeenCalled();
    expect(readSignupDraft()).toEqual({
      step: 'work',
      accent: '#65d8ac',
      authenticating: true,
      provider: 'microsoft',
    });
  });

  it('clears pending authentication when returning to an earlier step', () => {
    saveSignupDraft({ step: 'work', accent: '#65d8ac', authenticating: true });
    setup();
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to previous step' })
    );
    expect(readSignupDraft()).toEqual({
      step: 'security',
      accent: '#65d8ac',
      authenticating: false,
    });
  });

  it('offers returning users a way to sign in from the first slide only', () => {
    const { signIn } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in instead' }));
    expect(signIn).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(
      screen.queryByRole('button', { name: 'Sign in instead' })
    ).toBeNull();
  });
});
