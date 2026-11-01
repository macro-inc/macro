// @vitest-environment jsdom

import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  trackGoogleConversion: vi.fn(),
  success: vi.fn(),
  refetch: vi.fn(),
  setSearch: (_value: string) => {},
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({
    track: mocks.track,
    trackGoogleConversion: mocks.trackGoogleConversion,
  }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success },
}));
vi.mock('@queries/auth/user-info', () => ({
  useUserInfoQuery: () => ({ refetch: mocks.refetch }),
}));
vi.mock('@solidjs/router', async () => {
  const { createSignal } = await import('solid-js');
  const [search, setSearch] = createSignal('');
  mocks.setSearch = setSearch;
  return {
    useSearchParams: () => [
      {
        get subscriptionSuccess() {
          return new URLSearchParams(search()).get('subscriptionSuccess');
        },
        get subscriptionCancel() {
          return new URLSearchParams(search()).get('subscriptionCancel');
        },
        get type() {
          return new URLSearchParams(search()).get('type');
        },
        get tier() {
          return new URLSearchParams(search()).get('tier');
        },
      },
      () => {},
    ],
  };
});

import { subscriptionStartTransactionId } from '@app/lib/analytics/subscriptionStart';
import { useCheckoutCompletionListener } from './use-checkout-completion-listener';

const ADA = 'macro|ada@acme.com';

let dispose: (() => void) | undefined;
function mount() {
  return createRoot((cleanup) => {
    dispose = cleanup;
    return useCheckoutCompletionListener();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setSearch('');
  mocks.refetch.mockResolvedValue({
    data: { licenseStatus: 'active', userId: 'macro|ada@acme.com' },
  });
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.useRealTimers();
});

describe('checkout completion query changes', () => {
  it('gates a late success immediately, refreshes, and handles it only once', async () => {
    let finish!: (value: {
      data: { licenseStatus: string; userId: string };
    }) => void;
    mocks.refetch.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const pending = mount();
    expect(pending()).toBe(false);

    mocks.setSearch('?subscriptionSuccess=true&type=pro');
    expect(pending()).toBe(true);
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith('subscription_success', {
      type: 'pro',
    });
    expect(mocks.trackGoogleConversion).not.toHaveBeenCalled();
    finish({
      data: { licenseStatus: 'trialing', userId: 'macro|ada@acme.com' },
    });
    await vi.waitFor(() => expect(pending()).toBe(false));
    await vi.waitFor(() =>
      expect(mocks.trackGoogleConversion).toHaveBeenCalledOnce()
    );
    expect(mocks.trackGoogleConversion).toHaveBeenCalledExactlyOnceWith(
      'subscription_start',
      {
        value: 300,
        currency: 'USD',
        transaction_id: await subscriptionStartTransactionId(ADA),
      }
    );

    mocks.setSearch('');
    mocks.setSearch('?subscriptionSuccess=true&type=team');
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(pending()).toBe(false);
  });

  it('values a Max checkout above a Pro trial', async () => {
    mocks.setSearch('?subscriptionSuccess=true&type=max');
    const pending = mount();
    await vi.waitFor(() => expect(pending()).toBe(false));
    await vi.waitFor(() =>
      expect(mocks.trackGoogleConversion).toHaveBeenCalledOnce()
    );
    expect(mocks.trackGoogleConversion).toHaveBeenCalledExactlyOnceWith(
      'subscription_start',
      {
        value: 1000,
        currency: 'USD',
        transaction_id: await subscriptionStartTransactionId(ADA),
      }
    );
  });

  it('retains initial-query refresh behavior', async () => {
    mocks.setSearch('?subscriptionSuccess=true&type=pro');
    const pending = mount();
    expect(pending()).toBe(true);
    await vi.waitFor(() => expect(pending()).toBe(false));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it('records a late cancellation once without blocking navigation', () => {
    const pending = mount();
    mocks.setSearch('?subscriptionCancel=true&tier=pro');
    expect(mocks.track).toHaveBeenCalledWith('subscription_cancel', {
      tier: 'pro',
    });
    mocks.setSearch('');
    mocks.setSearch('?subscriptionCancel=true&tier=team');
    expect(mocks.track).toHaveBeenCalledTimes(1);
    expect(mocks.refetch).not.toHaveBeenCalled();
    expect(pending()).toBe(false);
  });

  it('stops polling after disposal during the retry delay', async () => {
    vi.useFakeTimers();
    mocks.refetch.mockResolvedValue({ data: { licenseStatus: 'inactive' } });
    mount();
    mocks.setSearch('?subscriptionSuccess=true');
    await Promise.resolve();
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    dispose?.();
    dispose = undefined;
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });
});

it('keeps the email in the user id out of the Google Ads transaction id', async () => {
  const id = await subscriptionStartTransactionId(ADA);
  expect(id).toMatch(/^[0-9a-f]{64}$/);
  expect(id).toBe(await subscriptionStartTransactionId(ADA));
});
