import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsInterface } from './analytics';
import { trackSignupCompletion } from './signupCompletion';

function analytics() {
  return {
    track: vi.fn(),
    trackMeta: vi.fn(),
    trackGoogleConversion: vi.fn(),
  };
}

afterEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/app/inbox');
});

describe('signup completion', () => {
  it('fires one CompleteRegistration with the profile event id', () => {
    window.history.replaceState({}, '', '/app/onboarding?signed_up=true');
    const client = analytics();

    trackSignupCompletion(client as unknown as AnalyticsInterface, {
      id: 'macro|new.user@example.com',
    });

    expect(client.trackMeta).toHaveBeenCalledTimes(1);
    expect(client.trackMeta).toHaveBeenCalledWith(
      'CompleteRegistration',
      {
        content_name: 'account_created',
        content_category: 'free',
        value: 20,
        currency: 'USD',
      },
      { eventID: 'signup:macro|new.user@example.com' }
    );
    expect(window.location.search).not.toContain('signed_up');

    trackSignupCompletion(client as unknown as AnalyticsInterface, {
      id: 'macro|new.user@example.com',
    });
    window.history.replaceState({}, '', '/app/onboarding?signed_up=true');
    trackSignupCompletion(client as unknown as AnalyticsInterface, {
      id: 'macro|new.user@example.com',
    });

    expect(client.trackMeta).toHaveBeenCalledTimes(1);
  });

  it('does not fire for a login or a returning session', () => {
    window.history.replaceState({}, '', '/app/inbox');
    const client = analytics();

    trackSignupCompletion(client as unknown as AnalyticsInterface, {
      id: 'macro|returning@example.com',
    });

    expect(client.track).not.toHaveBeenCalled();
    expect(client.trackMeta).not.toHaveBeenCalled();
    expect(client.trackGoogleConversion).not.toHaveBeenCalled();
  });
});
