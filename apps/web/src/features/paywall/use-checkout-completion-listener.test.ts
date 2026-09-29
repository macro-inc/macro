// @vitest-environment jsdom

import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  success: vi.fn(),
  refetch: vi.fn(),
  setSearch: (_value: string) => {},
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: mocks.track }),
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

import { useCheckoutCompletionListener } from './use-checkout-completion-listener';

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
  mocks.refetch.mockResolvedValue({ data: { licenseStatus: 'active' } });
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.useRealTimers();
});

describe('checkout completion query changes', () => {
  it('gates a late success immediately, refreshes, and handles it only once', async () => {
    let finish!: (value: { data: { licenseStatus: string } }) => void;
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
    finish({ data: { licenseStatus: 'active' } });
    await vi.waitFor(() => expect(pending()).toBe(false));

    mocks.setSearch('');
    mocks.setSearch('?subscriptionSuccess=true&type=team');
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(pending()).toBe(false);
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
