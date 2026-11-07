import { enableMacroComputers } from '@core/constant/featureFlags';
import type { SubscriptionBilling } from '@service-auth/generated/schemas';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createEffect, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConnectedTeamBillingBreakdown } from './team-billing-breakdown';

const mocks = vi.hoisted(() => ({
  read: () => ({ enabled: false, loading: true }),
  enabled: (): boolean => false,
  inventoryEnabled: (): boolean => false,
  offersRequest: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: unknown) =>
    flag === enableMacroComputers ? macroFlag : () => mocks.read(),
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
vi.mock('@queries/team-agents', () => ({
  useTeamAgentsQuery: (_id: unknown, enabled: () => boolean) => {
    mocks.enabled = enabled;
    return { isSuccess: true, isLoading: false, data: { agents: [] } };
  },
}));
vi.mock('../computers/views/BillingComputers', () => ({
  BillingComputers: () => <p>Existing computers view</p>,
}));

const [flag, setFlag] = createSignal({ enabled: false, loading: true });
const [macroFlag, setMacroFlag] = createSignal({
  enabled: false,
  loading: true,
});
const billing: SubscriptionBilling = {
  currency: 'usd',
  interval: 'month',
  humanSeats: { quantity: 1, amount: 2000 },
  agentSeats: { quantity: 1, amount: 2000 },
  subscriptionTotal: 7000,
  nextInvoice: null,
  lineItems: [
    {
      kind: 'computer',
      name: 'Assistant',
      size: 'standard',
      status: 'ready',
      quantity: 1,
      amount: 3000,
      included: false,
    },
  ],
};
beforeEach(() => {
  setFlag({ enabled: false, loading: true });
  mocks.read = flag;
  setMacroFlag({ enabled: false, loading: true });
  mocks.offersRequest.mockClear();
});
afterEach(cleanup);

it('waits for the rollout before choosing old or agent billing and disables roster requests while loading/off', () => {
  render(() => (
    <ConnectedTeamBillingBreakdown teamId="team-1" billing={billing} />
  ));
  expect(screen.getByRole('status').textContent).toContain(
    'Loading agent features'
  );
  expect(screen.queryByText('Existing computers view')).toBeNull();
  expect(screen.queryByText('Agent seats')).toBeNull();
  expect(mocks.enabled()).toBe(false);
  setFlag({ enabled: false, loading: false });
  expect(screen.getByText('Existing computers view')).toBeTruthy();
  expect(screen.queryByText('Agent seats')).toBeNull();
  expect(screen.queryByText('Assistant · Standard')).toBeNull();
  expect(mocks.enabled()).toBe(false);
  setFlag({ enabled: true, loading: false });
  expect(screen.queryByText('Existing computers view')).toBeNull();
  expect(screen.getByText('Agent seats')).toBeTruthy();
  expect(screen.getByText('Assistant · Standard')).toBeTruthy();
  expect(mocks.enabled()).toBe(true);
  setFlag({ enabled: false, loading: false });
  expect(screen.queryByText('Agent seats')).toBeNull();
  expect(screen.queryByText('Assistant · Standard')).toBeNull();
  expect(mocks.enabled()).toBe(false);
});

it.each([
  { enabled: false, loading: false },
  { enabled: true, loading: true },
])(
  'does not request offers with team agents on and macro computers $enabled/loading=$loading',
  (macro) => {
    setFlag({ enabled: true, loading: false });
    setMacroFlag(macro);
    render(() => (
      <ConnectedTeamBillingBreakdown teamId="team-1" billing={billing} />
    ));
    expect(mocks.offersRequest).not.toHaveBeenCalled();
    expect(mocks.enabled()).toBe(true);
    expect(mocks.inventoryEnabled()).toBe(true);
    expect(screen.getByText('Agent seats')).toBeTruthy();

    setMacroFlag({ enabled: true, loading: false });
    expect(mocks.offersRequest).toHaveBeenCalledTimes(1);
    expect(mocks.enabled()).toBe(true);
    expect(mocks.inventoryEnabled()).toBe(true);
  }
);
