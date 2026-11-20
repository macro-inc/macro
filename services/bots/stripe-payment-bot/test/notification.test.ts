import { describe, expect, mock, test } from 'bun:test';
import type Stripe from 'stripe';
import {
  formatNotification,
  notificationFromEvent,
  type StripeNotification,
} from '../src/notification';

function stripeStub(overrides?: {
  customer?: Stripe.Customer | Stripe.DeletedCustomer;
  subscription?: Stripe.Subscription;
}): Stripe {
  return {
    customers: { retrieve: async () => overrides?.customer },
    subscriptions: { retrieve: async () => overrides?.subscription },
  } as unknown as Stripe;
}

function checkoutEvent(
  overrides: Partial<Stripe.Checkout.Session> = {}
): Stripe.CheckoutSessionCompletedEvent {
  return {
    id: 'evt_checkout',
    livemode: true,
    type: 'checkout.session.completed',
    created: 1_700_000_000,
    data: {
      object: {
        mode: 'payment',
        payment_status: 'paid',
        amount_total: 2000,
        currency: 'usd',
        customer: 'cus_123',
        customer_details: {
          email: 'ada@example.com',
          name: 'Ada Lovelace',
        },
        subscription: null,
        ...overrides,
      },
    },
  } as Stripe.CheckoutSessionCompletedEvent;
}

function invoicePaidEvent(
  overrides: Partial<Stripe.Invoice> = {}
): Stripe.InvoicePaidEvent {
  return {
    id: 'evt_invoice',
    livemode: true,
    type: 'invoice.paid',
    data: {
      object: {
        id: 'in_subscription',
        lines: { data: [] },
        status: 'paid',
        amount_paid: 2000,
        currency: 'usd',
        customer: 'cus_123',
        parent: { subscription_details: { subscription: 'sub_123' } },
        ...overrides,
      },
    },
  } as Stripe.InvoicePaidEvent;
}

async function invoiceText(event: Stripe.InvoicePaidEvent) {
  const payment = await notificationFromEvent(stripeStub(), event);
  if (!payment) throw new Error('Missing invoice notification');
  return formatNotification(payment);
}

function subscriptionEvent(
  type: 'customer.subscription.deleted' | 'customer.subscription.updated',
  subscription: Partial<Stripe.Subscription>,
  previous?: Partial<Stripe.Subscription>
):
  | Stripe.CustomerSubscriptionDeletedEvent
  | Stripe.CustomerSubscriptionUpdatedEvent {
  return {
    id:
      type === 'customer.subscription.deleted' ? 'evt_deleted' : 'evt_updated',
    livemode: true,
    type,
    data: {
      object: {
        id: 'sub_123',
        customer: 'cus_123',
        cancel_at_period_end: false,
        cancel_at: null,
        cancellation_details: null,
        ...subscription,
      },
      previous_attributes: previous,
    },
  } as
    | Stripe.CustomerSubscriptionDeletedEvent
    | Stripe.CustomerSubscriptionUpdatedEvent;
}

const retrievedCustomer = {
  id: 'cus_123',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
} as Stripe.Customer;

describe('notificationFromEvent', () => {
  test('maps a paid checkout session to a payment', async () => {
    const notification = await notificationFromEvent(
      stripeStub(),
      checkoutEvent()
    );
    expect(notification).toEqual({
      kind: 'payment',
      amount: 2000,
      currency: 'usd',
      customer: 'Ada Lovelace (ada@example.com)',
      eventId: 'evt_checkout',
      livemode: true,
    });
  });

  test('ignores unpaid checkout sessions', async () => {
    const notification = await notificationFromEvent(
      stripeStub(),
      checkoutEvent({ payment_status: 'unpaid' })
    );
    expect(notification).toBeUndefined();
  });

  test('renewal uses the amount collected after credits', async () => {
    const invoice = invoicePaidEvent({
      billing_reason: 'subscription_cycle',
      total: 3000,
      amount_paid: 1800,
    });
    const text = await invoiceText(invoice);
    expect(text).toContain('Amount: $18.00 USD');
    expect(text).toContain('Reason: Subscription renewal');
  });

  test('formats Stripe minor units for ISK, UGX and JPY', async () => {
    for (const [currency, expected] of [
      ['isk', 'ISK 5 ISK'],
      ['ugx', 'UGX 5 UGX'],
      ['jpy', '¥500 JPY'],
    ]) {
      expect(
        await invoiceText(invoicePaidEvent({ currency, amount_paid: 500 }))
      ).toContain(expected);
    }
  });

  test('labels the collected proration for an added seat', async () => {
    const invoice = invoicePaidEvent({
      billing_reason: 'subscription_update',
      amount_paid: 653,
      total: 900,
    });
    invoice.data.object.lines.data.push({
      quantity: 1,
      parent: { subscription_item_details: { proration: true } },
    } as Stripe.InvoiceLineItem);
    const text = await invoiceText(invoice);
    expect(text).toContain('Amount: $6.53 USD');
    expect(text).toContain('Reason: Subscription change (prorated)');
  });

  test('checks later invoice lines for a prorated change', async () => {
    const invoice = invoicePaidEvent({ billing_reason: 'subscription_update' });
    invoice.data.object.lines.has_more = true;
    invoice.data.object.lines.data.push({
      id: 'il_first',
    } as Stripe.InvoiceLineItem);
    const listLineItems = mock(async function* () {
      yield { parent: { invoice_item_details: { proration: true } } };
    });
    const stripe = Object.assign(stripeStub(), { invoices: { listLineItems } });
    const payment = await notificationFromEvent(stripe, invoice);
    expect(listLineItems).toHaveBeenCalledWith(invoice.data.object.id, {
      starting_after: 'il_first',
      limit: 100,
    });
    expect(payment).toMatchObject({
      reason: 'Subscription change (prorated)',
    });
  });

  test('only the invoice announces a subscription checkout payment', async () => {
    const checkout = checkoutEvent({
      mode: 'subscription',
      subscription: 'sub_123',
    });
    const events = [
      checkout,
      {
        ...checkout,
        type: 'checkout.session.async_payment_succeeded',
      } as Stripe.Event,
      invoicePaidEvent({ billing_reason: 'subscription_create' }),
    ];
    const notifications = await Promise.all(
      events.map((event) => notificationFromEvent(stripeStub(), event))
    );
    expect(notifications.filter(Boolean)).toHaveLength(1);
    expect(notifications[2]).toMatchObject({
      kind: 'payment',
      reason: 'New subscription',
    });
  });

  test('preserves trial starts and ignores their zero-dollar invoices', async () => {
    const checkout = checkoutEvent({
      mode: 'subscription',
      amount_total: 0,
      payment_status: 'no_payment_required',
      subscription: 'sub_123',
    });
    const stripe = stripeStub({
      subscription: {
        id: 'sub_123',
        trial_start: checkout.created,
        trial_end: checkout.created + 86400,
      } as Stripe.Subscription,
    });
    expect(await notificationFromEvent(stripe, checkout)).toMatchObject({
      kind: 'trial',
      subscriptionId: 'sub_123',
    });
    expect(
      await notificationFromEvent(stripe, invoicePaidEvent({ amount_paid: 0 }))
    ).toBeUndefined();
  });

  test('ignores standalone invoices and unpaid subscription invoices', async () => {
    for (const overrides of [{ parent: null }, { status: 'open' as const }]) {
      expect(
        await notificationFromEvent(stripeStub(), invoicePaidEvent(overrides))
      ).toBeUndefined();
    }
  });

  test('maps subscription.deleted to an ended cancellation', async () => {
    const notification = await notificationFromEvent(
      stripeStub({ customer: retrievedCustomer }),
      subscriptionEvent('customer.subscription.deleted', {
        cancellation_details: {
          comment: 'Moving to annual later',
          feedback: 'too_expensive',
          reason: 'cancellation_requested',
        },
      })
    );
    expect(notification).toEqual({
      kind: 'cancellation',
      customer: 'Ada Lovelace (ada@example.com)',
      eventId: 'evt_deleted',
      livemode: true,
      subscriptionId: 'sub_123',
      timing: 'ended',
      reason: 'cancellation_requested',
      feedback: 'too_expensive',
      comment: 'Moving to annual later',
    });
  });

  test('maps cancel_at_period_end flipping on to a scheduled cancellation', async () => {
    const notification = await notificationFromEvent(
      stripeStub({ customer: retrievedCustomer }),
      subscriptionEvent(
        'customer.subscription.updated',
        {
          cancel_at_period_end: true,
          cancel_at: 1_720_000_000,
        },
        { cancel_at_period_end: false }
      )
    );
    expect(notification).toEqual({
      kind: 'cancellation',
      customer: 'Ada Lovelace (ada@example.com)',
      eventId: 'evt_updated',
      livemode: true,
      subscriptionId: 'sub_123',
      timing: 'scheduled',
      endsAt: 1_720_000_000,
    });
  });

  test('ignores subscription updates that are not a new cancel-at-period-end', async () => {
    const notification = await notificationFromEvent(
      stripeStub({ customer: retrievedCustomer }),
      subscriptionEvent(
        'customer.subscription.updated',
        { cancel_at_period_end: true, cancel_at: 1_720_000_000 },
        { metadata: { plan: 'pro' } } as Partial<Stripe.Subscription>
      )
    );
    expect(notification).toBeUndefined();
  });
});

describe('formatNotification', () => {
  test('formats a payment with a dashboard link', () => {
    const payment: StripeNotification = {
      kind: 'payment',
      amount: 2000,
      currency: 'usd',
      customer: 'Ada Lovelace (ada@example.com)',
      eventId: 'evt_checkout',
      livemode: true,
      subscriptionId: 'sub_123',
    };
    expect(formatNotification(payment)).toBe(
      [
        '💸 New Stripe payment',
        'Customer: Ada Lovelace (ada@example.com)',
        'Amount: $20.00 USD',
        'Subscription: sub_123',
        'https://dashboard.stripe.com/events/evt_checkout',
      ].join('\n')
    );
  });

  test('formats a scheduled cancellation', () => {
    const cancellation: StripeNotification = {
      kind: 'cancellation',
      customer: 'Ada Lovelace (ada@example.com)',
      eventId: 'evt_updated',
      livemode: false,
      subscriptionId: 'sub_123',
      timing: 'scheduled',
      endsAt: 1_720_000_000,
      reason: 'cancellation_requested',
    };
    expect(formatNotification(cancellation)).toBe(
      [
        '🚫 Stripe subscription cancellation scheduled',
        'Customer: Ada Lovelace (ada@example.com)',
        'Ends: 2024-07-03',
        'Reason: cancellation requested',
        'Subscription: sub_123',
        'https://dashboard.stripe.com/test/events/evt_updated',
      ].join('\n')
    );
  });

  test('formats an ended cancellation with feedback', () => {
    const cancellation: StripeNotification = {
      kind: 'cancellation',
      customer: 'Ada Lovelace (ada@example.com)',
      eventId: 'evt_deleted',
      livemode: true,
      subscriptionId: 'sub_123',
      timing: 'ended',
      reason: 'cancellation_requested',
      feedback: 'too_expensive',
      comment: 'Moving to annual later',
    };
    expect(formatNotification(cancellation)).toBe(
      [
        '🚫 Stripe subscription canceled',
        'Customer: Ada Lovelace (ada@example.com)',
        'Reason: cancellation requested',
        'Feedback: too expensive',
        'Comment: Moving to annual later',
        'Subscription: sub_123',
        'https://dashboard.stripe.com/events/evt_deleted',
      ].join('\n')
    );
  });
});
