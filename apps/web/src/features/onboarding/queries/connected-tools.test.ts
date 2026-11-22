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

  it('shows a linked GitHub account as linked, even with its tools off', () => {
    for (const status of ['connected', 'disabled'] as const)
      expect(
        onboardingToolState('github', ready([{ slug: 'github', status }]))
      ).toBe('account-linked');
    expect(
      onboardingToolState(
        'github',
        ready([{ slug: 'github', status: 'needsReauth' }])
      )
    ).toBe('available');
  });

  it('passes loading and failure through', () => {
    expect(onboardingToolState('linear', { t: 'loading' })).toBe('loading');
    expect(onboardingToolState('github', { t: 'error' })).toBe('error');
  });
});
