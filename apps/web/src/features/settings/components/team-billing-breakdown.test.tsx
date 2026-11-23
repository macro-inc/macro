import type { SubscriptionBilling } from '@service-auth/generated/schemas';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { TeamBillingBreakdown } from './team-billing-breakdown';

afterEach(cleanup);

function billingWith(
  status: SubscriptionBilling['lineItems'][number]['status']
): SubscriptionBilling {
  return {
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
        status,
        quantity: 1,
        amount: 3000,
        included: false,
      },
    ],
  };
}

it('names every computer state a billing line can carry', () => {
  for (const [status, label] of [
    ['waiting_for_capacity', 'Waiting for space on the host'],
    ['needs_attention', 'Needs attention — contact support'],
    ['ready', 'Alive'],
    [null, 'Status unavailable'],
  ] as const) {
    render(() => <TeamBillingBreakdown billing={billingWith(status)} />);
    expect(screen.getByText(label)).toBeTruthy();
    cleanup();
  }
});
