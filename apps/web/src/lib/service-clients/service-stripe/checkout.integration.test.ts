import { getFreePlanCheckoutRequest } from '@app/features/settings/core/billing-state';
import { authServiceClient } from '@service-auth/client';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { stripeServiceClient } from './client';

vi.mock('@core/constant/featureFlags', async (original) => ({
  ...(await original<typeof import('@core/constant/featureFlags')>()),
  ENABLE_BEARER_TOKEN_AUTH: true,
  LOCAL_ONLY: false,
}));

const token = `header.${btoa(JSON.stringify({ exp: 4_000_000_000 }))}.signature`;

beforeEach(() => {
  vi.spyOn(authServiceClient, 'macroApiToken').mockResolvedValue(
    ok({ macro_api_token: token })
  );
});
afterEach(() => vi.restoreAllMocks());

it.each([true, false])(
  'carries confirmed eligibility through the real authenticated HTTP clients (eligible=%s)',
  async (eligible) => {
    const fetch = vi
      .spyOn(window, 'fetch')
      .mockResolvedValueOnce(Response.json({ eligible }))
      .mockResolvedValueOnce(
        Response.json({
          url: 'https://checkout.stripe.com/confirmed',
          trialDays: eligible ? 30 : null,
        })
      );

    const offer = await authServiceClient.getTrialEligibility();
    expect(offer.isOk()).toBe(true);
    if (offer.isErr()) throw new Error('Eligibility request failed');
    await expect(
      stripeServiceClient.createCheckoutSessionV2(
        getFreePlanCheckoutRequest('premium', offer.value.eligible)
      )
    ).resolves.toBe('https://checkout.stripe.com/confirmed');

    expect(fetch.mock.calls[0]?.[0]).toMatch(
      /\/user\/stripe\/trial_eligibility$/
    );
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET');
    expect(fetch.mock.calls[1]?.[0]).toMatch(/\/user\/stripe\/checkoutv2$/);
    expect(fetch.mock.calls[1]?.[1]?.method).toBe('POST');
    const body = fetch.mock.calls[1]?.[1]?.body;
    if (typeof body !== 'string')
      throw new Error('Expected a JSON checkout body');
    expect(JSON.parse(body)).toMatchObject({
      plan: 'premium',
      onboardingTrial: eligible,
    });
    for (const [, init] of fetch.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        `Bearer ${token}`
      );
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  }
);

it('preserves a stale-trial conflict through the real transport without retrying a paid checkout', async () => {
  const message =
    'The 30-day trial is only available for your first Premium subscription';
  const fetch = vi
    .spyOn(window, 'fetch')
    .mockResolvedValueOnce(Response.json({ message }, { status: 409 }));
  await expect(
    stripeServiceClient.createCheckoutSessionV2({
      plan: 'premium',
      onboardingTrial: true,
    })
  ).rejects.toThrow(message);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not retry checkout after losing the HTTP response', async () => {
  const fetch = vi
    .spyOn(window, 'fetch')
    .mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await expect(
    stripeServiceClient.createCheckoutSessionV2({
      plan: 'premium',
      onboardingTrial: false,
    })
  ).rejects.toThrow('Network error occurred');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([401, 404, 500])(
  'treats eligibility HTTP %i as unknown, not ineligible',
  async (status) => {
    vi.spyOn(window, 'fetch').mockResolvedValueOnce(
      Response.json({ message: 'unavailable' }, { status })
    );
    const result = await authServiceClient.getTrialEligibility();
    expect(result.isErr()).toBe(true);
  }
);

it('rejects an advertised trial when the HTTP response confirms paid terms', async () => {
  vi.spyOn(window, 'fetch').mockResolvedValueOnce(
    Response.json({
      url: 'https://checkout.stripe.com/paid',
      trialDays: null,
    })
  );
  await expect(
    stripeServiceClient.createCheckoutSessionV2({
      plan: 'premium',
      onboardingTrial: true,
    })
  ).rejects.toThrow('Your free trial could not be confirmed');
});
