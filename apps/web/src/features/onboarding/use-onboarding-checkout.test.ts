/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createCheckoutSessionV2: vi.fn(),
}));

vi.mock('@service-stripe/client', () => ({
  stripeServiceClient: {
    createCheckoutSessionV2: mocks.createCheckoutSessionV2,
  },
}));

import { createOnboardingCheckoutSession } from './use-onboarding-checkout';

beforeEach(() => {
  mocks.createCheckoutSessionV2.mockReset();
});

describe('createOnboardingCheckoutSession', () => {
  it('uses the supported v2 checkout endpoint and returns both legs to the flow', async () => {
    mocks.createCheckoutSessionV2.mockResolvedValue('https://checkout.test/1');

    await expect(createOnboardingCheckoutSession('premium')).resolves.toEqual({
      checkoutUrl: 'https://checkout.test/1',
    });
    expect(mocks.createCheckoutSessionV2).toHaveBeenCalledOnce();
    expect(mocks.createCheckoutSessionV2).toHaveBeenCalledWith({
      successUrl: `${window.location.origin}/app/onboarding?subscriptionSuccess=true&type=premium`,
      cancelUrl: `${window.location.origin}/app/onboarding?subscriptionCancel=true`,
    });
  });

  it('rejects an empty checkout URL', async () => {
    mocks.createCheckoutSessionV2.mockResolvedValue('');

    await expect(createOnboardingCheckoutSession('premium')).rejects.toThrow(
      'No checkout URL returned'
    );
  });
});
