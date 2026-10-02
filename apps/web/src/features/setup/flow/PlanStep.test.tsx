import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  info: { licenseStatus: 'free' },
  refetch: vi.fn(),
  track: vi.fn(),
}));
vi.mock('@solidjs/router', () => ({ useSearchParams: () => [mocks.params] }));
vi.mock('@queries/auth/user-info', () => ({
  useUserInfoQuery: () => ({
    isSuccess: true,
    data: mocks.info,
    refetch: mocks.refetch,
  }),
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: mocks.track }),
}));

import { PlanStep } from './PlanStep';

beforeEach(() => {
  mocks.params = {};
  mocks.info = { licenseStatus: 'free' };
  mocks.refetch.mockReset();
  mocks.track.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const checkout = vi.fn();
  const finish = vi.fn().mockResolvedValue(undefined);
  render(() => (
    <PlanStep
      finishing={false}
      onStartCheckout={checkout}
      onPremiumPaid={finish}
    />
  ));
  return { checkout, finish };
}

describe('live trial checkout', () => {
  it('starts hosted checkout without collecting payment details locally', () => {
    const { checkout, finish } = setup();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start 30 day trial' }));
    expect(checkout).toHaveBeenCalledWith('premium');
    expect(finish).not.toHaveBeenCalled();
  });
  it('automatically finishes only after a server-confirmed paid license', async () => {
    mocks.params = { subscriptionSuccess: 'true', type: 'max' };
    mocks.refetch.mockResolvedValue({ data: { licenseStatus: 'active' } });
    const { finish, checkout } = setup();
    await waitFor(() => expect(finish).toHaveBeenCalledWith('max'));
    expect(checkout).not.toHaveBeenCalled();
  });
  it('does not treat a success URL alone as payment confirmation', async () => {
    mocks.params = { subscriptionSuccess: 'true' };
    mocks.refetch.mockRejectedValue(new Error('offline'));
    const { finish } = setup();
    await screen.findByRole('alert');
    expect(finish).not.toHaveBeenCalled();
    mocks.refetch.mockResolvedValue({ data: { licenseStatus: 'trialing' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to workspace' })
    );
    await waitFor(() => expect(finish).toHaveBeenCalledOnce());
  });
  it('leaves cancellation retryable without completing onboarding', () => {
    mocks.params = { subscriptionCancel: 'true' };
    const { finish } = setup();
    expect(
      screen.getByRole('button', { name: 'Start 30 day trial' })
    ).toBeTruthy();
    expect(finish).not.toHaveBeenCalled();
  });
  it('allows existing paid members to finish without buying again', async () => {
    mocks.info.licenseStatus = 'active';
    mocks.refetch.mockResolvedValue({ data: mocks.info });
    const { finish, checkout } = setup();
    await waitFor(() => expect(finish).toHaveBeenCalledOnce());
    expect(checkout).not.toHaveBeenCalled();
  });
});
