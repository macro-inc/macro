import { loadableQuery } from '@app/features/onboarding/queries/loadable-query';
import { cleanup, render } from '@solidjs/testing-library';
import {
  focusManager,
  onlineManager,
  QueryClientProvider,
} from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { queryClient } from '../client';
import {
  useCreateCheckoutSessionMutation,
  useTrialEligibilityQuery,
} from './stripe-checkout';

const mocks = vi.hoisted(() => ({ eligibility: vi.fn(), checkout: vi.fn() }));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { getTrialEligibility: mocks.eligibility },
}));
vi.mock('@service-stripe/client', () => ({
  stripeServiceClient: { createCheckoutSessionV2: mocks.checkout },
}));
vi.mock('../client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 300_000,
          refetchOnWindowFocus: false,
          retryDelay: 0,
        },
      },
    }),
  };
});

function setup() {
  let checkout: ReturnType<typeof useCreateCheckoutSessionMutation> | undefined;
  function Offer() {
    const query = useTrialEligibilityQuery();
    checkout = useCreateCheckoutSessionMutation();
    const label = () => {
      const value = loadableQuery(query, (offer) => offer.eligible, {
        retainDataOnError: false,
      });
      return value.t === 'ready' ? (value.value ? 'trial' : 'paid') : value.t;
    };
    return (
      <button disabled={label() === 'loading' || label() === 'error'}>
        {label()}
      </button>
    );
  }
  return {
    ...render(() => (
      <QueryClientProvider client={queryClient}>
        <Offer />
      </QueryClientProvider>
    )),
    checkout: () => checkout,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.eligibility
    .mockResolvedValueOnce(ok({ eligible: true, existingSubscription: false }))
    .mockResolvedValue(ok({ eligible: false, existingSubscription: false }));
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.resetAllMocks();
  vi.useRealTimers();
});

it.each(['focus', 'reconnect'])(
  'refreshes trial eligibility on %s despite global caching defaults',
  async (event) => {
    const view = setup();
    await vi.advanceTimersByTimeAsync(1);
    expect(view.container.textContent).toBe('trial');
    if (event === 'focus') {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    } else {
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    }
    await vi.advanceTimersByTimeAsync(1);
    expect(view.container.textContent).toBe('paid');
    expect(mocks.eligibility).toHaveBeenCalledTimes(2);
  }
);

it('refreshes the real eligibility query after a checkout conflict without a paid retry', async () => {
  const view = setup();
  await vi.advanceTimersByTimeAsync(1);
  const paidEligibility = ok({ eligible: false, existingSubscription: false });
  const refreshed = Promise.withResolvers<typeof paidEligibility>();
  mocks.eligibility.mockReturnValueOnce(refreshed.promise);
  mocks.checkout.mockRejectedValue(new Error('Trial no longer available'));
  await expect(
    view.checkout()?.mutateAsync({ plan: 'premium', onboardingTrial: true })
  ).rejects.toThrow('Trial no longer available');
  await vi.advanceTimersByTimeAsync(1);
  expect(view.container.textContent).toBe('loading');
  expect(view.container.querySelector('button')?.disabled).toBe(true);
  refreshed.resolve(paidEligibility);
  await vi.advanceTimersByTimeAsync(1);
  expect(view.container.textContent).toBe('paid');
  expect(mocks.checkout).toHaveBeenCalledTimes(1);
  expect(mocks.eligibility).toHaveBeenCalledTimes(2);
});

it('removes the retained trial offer when a refresh fails', async () => {
  const view = setup();
  await vi.advanceTimersByTimeAsync(1);
  expect(view.container.textContent).toBe('trial');
  mocks.eligibility.mockResolvedValue(err('unavailable'));
  focusManager.setFocused(false);
  focusManager.setFocused(true);
  await vi.advanceTimersByTimeAsync(10);
  expect(view.container.textContent).toBe('error');
});
