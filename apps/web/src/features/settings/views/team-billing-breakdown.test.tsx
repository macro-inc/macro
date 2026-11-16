import type { SubscriptionBilling } from '@service-auth/generated/schemas';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createEffect, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConnectedTeamBillingBreakdown } from './team-billing-breakdown';

const mocks = vi.hoisted(() => ({
  inventoryEnabled: (): boolean => false,
  offersRequest: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => macroFlag,
}));
vi.mock('@queries/computers/computers', () => ({
  useComputersQuery: (enabled: () => boolean) => {
    mocks.inventoryEnabled = enabled;
    return { isPending: false, data: [] };
  },
  useComputerOffersQuery: (enabled: () => boolean) => {
    createEffect(() => {
      if (enabled()) mocks.offersRequest();
    });
    return { isPending: false, data: [] };
  },
}));
vi.mock('../computers/views/BillingComputers', () => ({
  BillingComputers: () => <p>Existing computers view</p>,
}));

const [macroFlag, setMacroFlag] = createSignal({
  enabled: false,
  loading: true,
});
const billing: SubscriptionBilling = {
  currency: 'usd',
  interval: 'month',
  humanSeats: { quantity: 1, amount: 2000 },
  subscriptionTotal: 5000,
  nextInvoice: null,
  lineItems: [
    {
      kind: 'computer',
      name: 'Build box',
      size: 'standard',
      status: 'ready',
      quantity: 1,
      amount: 3000,
      included: false,
    },
  ],
};
beforeEach(() => {
  setMacroFlag({ enabled: false, loading: true });
  mocks.offersRequest.mockClear();
});
afterEach(cleanup);

it('waits for the rollout before choosing the existing view or the breakdown', () => {
  render(() => (
    <ConnectedTeamBillingBreakdown teamId="team-1" billing={billing} />
  ));
  expect(screen.getByRole('status')).toBeTruthy();
  expect(screen.queryByText('Existing computers view')).toBeNull();
  expect(mocks.inventoryEnabled()).toBe(false);
  expect(mocks.offersRequest).not.toHaveBeenCalled();

  setMacroFlag({ enabled: false, loading: false });
  expect(screen.getByText('Existing computers view')).toBeTruthy();
  expect(screen.queryByText('Build box · Standard')).toBeNull();
  expect(mocks.inventoryEnabled()).toBe(false);
  expect(mocks.offersRequest).not.toHaveBeenCalled();

  setMacroFlag({ enabled: true, loading: false });
  expect(screen.queryByText('Existing computers view')).toBeNull();
  expect(screen.getByText('Human seats')).toBeTruthy();
  expect(screen.getByText('Build box · Standard')).toBeTruthy();
  expect(mocks.inventoryEnabled()).toBe(true);
  expect(mocks.offersRequest).toHaveBeenCalledTimes(1);
});
