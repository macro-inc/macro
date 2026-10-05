import { cleanup, fireEvent, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSignupDraft, saveSignupDraft } from '../primitives/flow-storage';
import {
  renderWithFakeOnboarding,
  stubOnboardingBrowser,
} from '../tests/render';
import { SignupJourneyView } from './signup-journey-view';

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
  renderWithFakeOnboarding(
    () => (
      <SignupJourneyView
        onGoogle={google}
        onBackFromEmail={() => {}}
        showingEmail={false}
      />
    ),
    { viewer: null }
  );
  return { google };
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
    fireEvent.click(screen.getByRole('button', { name: 'Connect work email' }));
    expect(google).toHaveBeenCalledOnce();
    expect(readSignupDraft()).toEqual({
      step: 'work',
      accent: '#f77d67',
      authenticating: true,
    });
  });

  it('restores the work-email step after an OAuth return or cancellation', () => {
    saveSignupDraft({ step: 'work', accent: '#65d8ac', authenticating: true });
    const { google } = setup();
    expect(
      screen.queryByRole('heading', { name: 'Create your workspace' })
    ).toBeNull();
    expect(google).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect work email' }));
    expect(google).toHaveBeenCalledOnce();
    expect(readSignupDraft()?.accent).toBe('#65d8ac');
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
});
