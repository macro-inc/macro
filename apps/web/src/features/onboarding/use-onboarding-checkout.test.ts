/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';

import { onboardingCheckoutArgs } from './use-onboarding-checkout';

describe('onboardingCheckoutArgs', () => {
  it('returns both checkout legs to the onboarding flow with the plan', () => {
    expect(onboardingCheckoutArgs('premium')).toEqual({
      successUrl: `${window.location.origin}/app/onboarding?subscriptionSuccess=true&type=premium`,
      cancelUrl: `${window.location.origin}/app/onboarding?subscriptionCancel=true`,
      plan: 'premium',
    });
  });

  it('carries the purchased tier back on the success leg', () => {
    const args = onboardingCheckoutArgs('max');
    expect(args.plan).toBe('max');
    expect(args.successUrl).toBe(
      `${window.location.origin}/app/onboarding?subscriptionSuccess=true&type=max`
    );
    expect(args.cancelUrl).toBe(
      `${window.location.origin}/app/onboarding?subscriptionCancel=true`
    );
  });
});
