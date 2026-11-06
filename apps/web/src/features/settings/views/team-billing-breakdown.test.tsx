import type { SubscriptionBilling } from '@service-auth/generated/schemas';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConnectedTeamBillingBreakdown } from './team-billing-breakdown';

const mocks = vi.hoisted(() => ({
  read: () => ({ enabled: false, loading: true }),
  enabled: (): boolean => false,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => mocks.read(),
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
