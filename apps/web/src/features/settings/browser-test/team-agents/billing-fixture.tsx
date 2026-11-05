import type {
  SubscriptionBilling,
  TeamAgent,
} from '@service-auth/generated/schemas';
import { createSignal, Show } from 'solid-js';
import { TeamBillingBreakdown } from '../../components/team-billing-breakdown';
import { SettingsPage } from '../../primitives';

export const BILLING: SubscriptionBilling = {
  currency: 'usd',
  interval: 'month',
  humanSeats: { quantity: 3, amount: 6000 },
  agentSeats: { quantity: 2, amount: 4000 },
  lineItems: [
    {
      kind: 'human_seat',
      plan: 'premium',
      quantity: 3,
      unitAmount: 2000,
      amount: 6000,
      computerId: null,
      agentUserId: null,
      name: 'Pro seats',
      size: null,
      status: null,
      included: false,
    },
    {
      kind: 'agent_seat',
      plan: 'premium',
      quantity: 2,
      unitAmount: 2000,
      amount: 4000,
      computerId: null,
      agentUserId: null,
      name: 'Agent seats',
      size: null,
      status: null,
      included: false,
    },
    {
      kind: 'computer',
      plan: null,
      quantity: 1,
      unitAmount: 3000,
      amount: 3000,
      computerId: 'computer-1',
      agentUserId: 'agent-1',
      name: 'Assistant',
      size: 'standard',
      status: 'ready',
      included: false,
    },
    {
      kind: 'computer',
      plan: null,
      quantity: 1,
      unitAmount: 3000,
      amount: 3000,
      computerId: 'computer-2',
      agentUserId: 'agent-2',
      name: 'Research agent',
      size: 'large',
      status: 'setting_up',
      included: false,
    },
    {
      kind: 'computer',
      plan: null,
      quantity: 1,
      unitAmount: 0,
      amount: 0,
      computerId: 'computer-3',
      agentUserId: 'agent-3',
      name: 'Included agent',
      size: 'xl',
      status: 'ready',
      included: true,
    },
    {
      kind: 'other',
      plan: null,
      quantity: 1,
      unitAmount: 3000,
      amount: 3000,
      computerId: null,
      agentUserId: null,
      name: 'Extra storage',
      size: null,
      status: null,
      included: false,
    },
  ],
  subscriptionTotal: 19000,
  nextInvoice: { date: '2026-12-05T12:00:00Z', amount: 22345 },
};

export function BillingFixture() {
  const params = new URLSearchParams(location.search);
  const [health, setHealth] = createSignal<TeamAgent['status']>('unhealthy');
  const agents = (): TeamAgent[] =>
    params.has('unhealthy')
      ? [
          {
            userId: 'agent-1',
            teamId: 'team-1',
            name: 'Assistant',
            email: 'agent@example.com',
            createdAt: '2026-01-01',
            computerId: 'computer-1',
            status: health(),
            retryable: false,
            payment: 'paid',
          },
        ]
      : [];
  const billing = () => ({
    ...BILLING,
    interval: params.has('annual') ? ('year' as const) : ('month' as const),
    currency: params.get('currency') ?? (params.has('eur') ? 'eur' : 'usd'),
  });
  return (
    <SettingsPage
      title="Billing"
      actions={
        <Show when={params.has('unhealthy')}>
          <button type="button" onClick={() => setHealth('running')}>
            Restore agent health
          </button>
        </Show>
      }
    >
      <Show
        when={!params.has('no-plan')}
        fallback={<p>No active subscription</p>}
      >
        <TeamBillingBreakdown billing={billing()} agents={agents()} />
      </Show>
    </SettingsPage>
  );
}
