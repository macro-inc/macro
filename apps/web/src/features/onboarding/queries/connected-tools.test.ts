import { describe, expect, it } from 'vitest';
import {
  type HeldApp,
  onboardingConnectedTools,
  onboardingToolState,
} from './connected-tools';

const ready = (value: HeldApp[]) => ({ t: 'ready', value }) as const;

describe('onboarding connections', () => {
  it('counts only the apps the server says are connected', () => {
    expect(
      onboardingConnectedTools([
        { slug: 'linear', status: 'connected' },
        { slug: 'notion', status: 'disabled' },
        { slug: 'slack', status: 'needsReauth' },
        { slug: 'stripe', status: 'notConnected' },
      ])
    ).toEqual(new Set(['linear']));
  });

  it('reads each server status as a tile state', () => {
    const apps = ready([
      { slug: 'linear', status: 'connected' },
      { slug: 'notion', status: 'disabled' },
      { slug: 'slack', status: 'needsReauth' },
      { slug: 'stripe', status: 'notConnected' },
    ]);
    expect(onboardingToolState('linear', apps)).toBe('connected');
    expect(onboardingToolState('notion', apps)).toBe('disabled');
    expect(onboardingToolState('slack', apps)).toBe('available');
    expect(onboardingToolState('stripe', apps)).toBe('available');
    expect(onboardingToolState('figma', apps)).toBe('available');
  });

  it('reads GitHub like any app: only the server says it is connected', () => {
    // A flagged user's linked account does not count; the server says so.
    expect(
      onboardingToolState(
        'github',
        ready([{ slug: 'github', status: 'notConnected' }])
      )
    ).toBe('available');
    expect(
      onboardingToolState(
        'github',
        ready([{ slug: 'github', status: 'connected' }])
      )
    ).toBe('connected');
  });

  it('passes loading and failure through', () => {
    expect(onboardingToolState('linear', { t: 'loading' })).toBe('loading');
    expect(onboardingToolState('github', { t: 'error' })).toBe('error');
  });
});
