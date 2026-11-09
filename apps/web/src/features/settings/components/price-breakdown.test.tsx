import type { SubscriptionBilling } from '@service-auth/generated/schemas';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { PriceBreakdown } from './price-breakdown';
import { TeamBillingBreakdown } from './team-billing-breakdown';

afterEach(cleanup);
it('preserves provider charges separately from catalog prices and the next invoice', () => {
  const billing: SubscriptionBilling = {
    currency: 'usd',
    interval: 'month',
    humanSeats: { quantity: 1, amount: 2000 },
    subscriptionTotal: 5000,
    nextInvoice: { amount: 5345, date: '2026-12-05' },
    lineItems: [
      {
        kind: 'computer',
        name: 'Build machine',
        size: 'large',
        computerId: 'computer-1',
        quantity: 1,
        unitAmount: 3000,
        amount: 3000,
        included: false,
        status: 'ready',
      },
    ],
  };
  render(() => (
    <TeamBillingBreakdown
      billing={billing}
      offers={[
        {
          size: 'large',
          vcpus: 8,
          memoryGb: 16,
          diskGb: 200,
          soldOut: false,
          notifyRequested: false,
          quote: {
            size: 'large',
            amount: 6000,
            currency: 'usd',
            interval: 'month',
            priceId: 'price_large',
          },
        },
      ]}
    />
  ));
  expect(screen.getByText('$30.00')).toBeTruthy();
  expect(screen.getByText('$50.00')).toBeTruthy();
  expect(screen.getByText('$53.45')).toBeTruthy();
  expect(
    screen.getByText(
      'New computers: $60.00/month. Your subscribed price is retained.'
    )
  ).toBeTruthy();
  expect(screen.queryByText('Computers', { exact: true })).toBeNull();
});
it('keeps included item details and total without inventing a charge', () => {
  render(() => (
    <PriceBreakdown
      items={[
        {
          name: 'Human seat',
          description: '1 paid seat',
          amount: 0,
          included: true,
        },
        {
          name: 'Standard computer',
          description: '4 vCPU · 8 GiB memory · 100 GiB disk',
          amount: 0,
          included: true,
        },
      ]}
      currency="usd"
      interval="month"
      total={0}
      included
    />
  ));
  expect(screen.getByText('4 vCPU · 8 GiB memory · 100 GiB disk')).toBeTruthy();
  expect(screen.getAllByText('Included', { exact: true })).toHaveLength(3);
  expect(screen.queryByText('$0.00')).toBeNull();
});

it('never hides actual subscription charges behind included item metadata', () => {
  render(() => (
    <TeamBillingBreakdown
      billing={{
        currency: 'usd',
        interval: 'month',
        humanSeats: { quantity: 1, amount: 2000 },
            subscriptionTotal: 2000,
        lineItems: [
          {
            name: 'Included computer',
            kind: 'computer',
            amount: 0,
            quantity: 1,
            included: true,
          },
        ],
      }}
    />
  ));
  expect(screen.getAllByText('$20.00')).toHaveLength(2);
});
