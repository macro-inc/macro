import { describe, expect, it } from 'vitest';
import { onboardingCheckoutRequest, parseCheckoutReturn } from './checkout';

const ONBOARDING = 'https://macro.com/app/onboarding';

describe('onboardingCheckoutRequest', () => {
  it('returns both checkout legs to the onboarding flow with the plan', () => {
    expect(onboardingCheckoutRequest(ONBOARDING, 'premium')).toEqual({
      successUrl: `${ONBOARDING}?subscriptionSuccess=true&type=premium`,
      cancelUrl: `${ONBOARDING}?subscriptionCancel=true`,
      plan: 'premium',
      onboardingTrial: true,
    });
  });

  it('requests the trial only for Premium', () => {
    const request = onboardingCheckoutRequest(ONBOARDING, 'max');
    expect(request.plan).toBe('max');
    expect(request.onboardingTrial).toBe(false);
    expect(request.successUrl).toBe(
      `${ONBOARDING}?subscriptionSuccess=true&type=max`
    );
  });
});

describe('parseCheckoutReturn', () => {
  it.each([
    [{}, undefined],
    [{ subscriptionCancel: 'true' }, { t: 'cancelled' }],
    [{ subscriptionSuccess: 'true' }, { t: 'success', tier: 'premium' }],
    [
      { subscriptionSuccess: 'true', type: 'max' },
      { t: 'success', tier: 'max' },
    ],
    [
      { subscriptionSuccess: 'true', type: 'anything' },
      { t: 'success', tier: 'premium' },
    ],
  ])('%o → %o', (params, expected) => {
    expect(parseCheckoutReturn(params)).toEqual(expected);
  });

  it('round-trips the legs the request builds', () => {
    const request = onboardingCheckoutRequest(ONBOARDING, 'max');
    const leg = (url: string) =>
      Object.fromEntries(new URL(url).searchParams.entries());
    expect(parseCheckoutReturn(leg(request.successUrl))).toEqual({
      t: 'success',
      tier: 'max',
    });
    expect(parseCheckoutReturn(leg(request.cancelUrl))).toEqual({
      t: 'cancelled',
    });
  });
});
