import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ checkout: vi.fn() }));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { createCheckoutSessionV2: mocks.checkout },
}));
vi.mock('@core/util/mockClient', () => ({ registerClient: vi.fn() }));

import { stripeServiceClient } from './client';

beforeEach(() => mocks.checkout.mockReset());
const url = 'https://checkout.stripe.com/test';
const response = (trialDays?: number | null) => ({
  isOk: () => true,
  value: { url, trialDays },
});

describe('automatic onboarding trial checkout', () => {
  it('requests the trial without a code and returns its confirmed checkout', async () => {
    mocks.checkout.mockResolvedValue(response(30));
    await expect(
      stripeServiceClient.createCheckoutSessionV2({
        plan: 'premium',
        onboardingTrial: true,
      })
    ).resolves.toBe(url);
    expect(mocks.checkout).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: 'premium',
        onboardingTrial: true,
        discount: null,
      })
    );
  });

  it.each([undefined, null, 0, 7])(
    'refuses a trial redirect when the backend returns %s trial days',
    async (days) => {
      mocks.checkout.mockResolvedValue(response(days));
      await expect(
        stripeServiceClient.createCheckoutSessionV2({
          plan: 'premium',
          onboardingTrial: true,
        })
      ).rejects.toThrow('Your free trial could not be confirmed');
    }
  );

  it('preserves normal paid checkout for callers that did not request a trial', async () => {
    mocks.checkout.mockResolvedValue(response());
    await expect(
      stripeServiceClient.createCheckoutSessionV2({ plan: 'premium' })
    ).resolves.toBe(url);
  });

  it('preserves an ineligibility error instead of redirecting to paid checkout', async () => {
    mocks.checkout.mockResolvedValue({
      isOk: () => false,
      error: [
        {
          message:
            'The 30-day trial is only available for your first Premium subscription',
        },
      ],
    });
    await expect(
      stripeServiceClient.createCheckoutSessionV2({ onboardingTrial: true })
    ).rejects.toThrow('only available for your first Premium subscription');
  });
});
