import { describe, expect, it } from 'vitest';
import {
  buildGoogleWorkOnboardingUrl,
  consumeOnboardingHandoff,
  createOnboardingHandoff,
  hasOnboardingHandoff,
  ONBOARDING_FLOW_STEP_STORAGE_KEY,
  ONBOARDING_HANDOFF_STORAGE_KEY,
  onboardingReturnPath,
  peekOnboardingHandoff,
} from './onboardingHandoff';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  };
}

describe('Google work onboarding handoff', () => {
  it('keeps an explicit journey available after the OAuth marker is consumed', () => {
    const storage = memoryStorage();
    createOnboardingHandoff(storage);
    expect(hasOnboardingHandoff(storage)).toBe(true);
    consumeOnboardingHandoff(storage);
    expect(hasOnboardingHandoff(storage, 'user-one')).toBe(false);
    storage.setItem(
      ONBOARDING_FLOW_STEP_STORAGE_KEY,
      JSON.stringify({ user: 'user-one', step: 'connect-github' })
    );
    expect(hasOnboardingHandoff(storage, 'user-one')).toBe(true);
    expect(hasOnboardingHandoff(storage, 'user-two')).toBe(false);
    expect(hasOnboardingHandoff(storage)).toBe(false);
    storage.removeItem(ONBOARDING_FLOW_STEP_STORAGE_KEY);
    expect(hasOnboardingHandoff(storage, 'user-one')).toBe(false);
  });

  it('ignores malformed saved flow state', () => {
    const storage = memoryStorage();
    for (const value of ['{bad', '{}', '{"user":"user-one","step":1}']) {
      storage.setItem(ONBOARDING_FLOW_STEP_STORAGE_KEY, value);
      expect(hasOnboardingHandoff(storage, 'user-one')).toBe(false);
    }
  });

  it('preserves invitation, referral, and campaign parameters through the login URL', () => {
    const url = new URL(
      buildGoogleWorkOnboardingUrl(
        'https://macro.com/app/login?utm_source=launch',
        {
          next: '/app/team-invite?invite=team-123',
          referralCode: 'founder-referral',
        }
      )
    );
    expect(url.origin + url.pathname).toBe('https://macro.com/app/login');
    expect(url.searchParams.get('onboarding')).toBe('google-work');
    expect(url.searchParams.get('next')).toBe('/team-invite?invite=team-123');
    expect(url.searchParams.get('referral_code')).toBe('founder-referral');
    expect(url.searchParams.get('utm_source')).toBe('launch');
  });

  it('restores after OAuth exactly once and leaves other session data intact', () => {
    const storage = memoryStorage();
    storage.setItem('other-session', 'keep');
    createOnboardingHandoff(storage, { next: '/component/tasks' }, 1_000);
    expect(peekOnboardingHandoff(storage, 2_000)).toEqual({
      step: 'email',
      createdAt: 1_000,
      next: '/component/tasks',
    });
    expect(consumeOnboardingHandoff(storage, 3_000)?.step).toBe('email');
    expect(consumeOnboardingHandoff(storage, 3_001)).toBeUndefined();
    expect(storage.getItem('other-session')).toBe('keep');
  });

  it('expires abandoned signup intent instead of applying it to a later session', () => {
    const storage = memoryStorage();
    createOnboardingHandoff(storage, {}, 1_000);
    expect(peekOnboardingHandoff(storage, 31 * 60 * 1_000)).toBeUndefined();
    expect(storage.getItem(ONBOARDING_HANDOFF_STORAGE_KEY)).toBeNull();
  });

  it('rejects malformed and future markers', () => {
    const storage = memoryStorage();
    for (const value of [
      '{bad',
      '{}',
      '{"step":"email","createdAt":999999}',
      '{"step":"email","createdAt":"0"}',
    ]) {
      storage.setItem(ONBOARDING_HANDOFF_STORAGE_KEY, value);
      expect(consumeOnboardingHandoff(storage, 1_000)).toBeUndefined();
      expect(storage.getItem(ONBOARDING_HANDOFF_STORAGE_KEY)).toBeNull();
    }
  });

  it('never turns a return path into an external redirect', () => {
    for (const path of [
      'https://other.test',
      '//other.test',
      '/app//other.test',
      '/\\other.test',
      '/\n/other.test',
      ' /team-invite',
    ]) {
      expect(onboardingReturnPath(path)).toBeUndefined();
      const url = new URL(
        buildGoogleWorkOnboardingUrl('https://macro.com/app/login', {
          next: path,
        })
      );
      expect(url.searchParams.has('next')).toBe(false);
    }
  });

  it('keeps signup usable when browser session storage is blocked', () => {
    const unavailable = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    };
    expect(createOnboardingHandoff(unavailable).step).toBe('email');
    expect(peekOnboardingHandoff(unavailable)).toBeUndefined();
    expect(consumeOnboardingHandoff(unavailable)).toBeUndefined();
  });
});
