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
    customers: {
      retrieve: mock(async () => {
        if (!overrides?.customer) {
          throw new Error('customers.retrieve should not be called');
        }
        return overrides.customer;
      }),
    },
    subscriptions: {
      retrieve: mock(async () => {
        if (!overrides?.subscription) {
          throw new Error('subscriptions.retrieve should not be called');
        }
        return overrides.subscription;
      }),
    },
  } as unknown as Stripe;
}

function checkoutEvent(
  overrides: Partial<Stripe.Checkout.Session> & {
    eventId?: string;
    livemode?: boolean;
  } = {}
): Stripe.CheckoutSessionCompletedEvent {
  const { eventId, livemode, ...session } = overrides;
  return {
    id: eventId ?? 'evt_checkout',
    livemode: livemode ?? true,
    type: 'checkout.session.completed',
    data: {
      object: {
        payment_status: 'paid',
        amount_total: 2000,
        currency: 'usd',
        customer: 'cus_123',
        customer_details: {
          email: 'ada@example.com',
          name: 'Ada Lovelace',
        },
        customer_email: null,
        subscription: 'sub_123',
        ...session,
      },
    },
  } as Stripe.CheckoutSessionCompletedEvent;
}

function invoicePaidEvent(
  overrides: Partial<Stripe.Invoice> & {
    eventId?: string;
    livemode?: boolean;
  } = {}
): Stripe.InvoicePaidEvent {
  const { eventId, livemode, ...invoice } = overrides;
  return {
    id: eventId ?? 'evt_invoice',
    livemode: livemode ?? true,
    type: 'invoice.paid',
    data: {
      object: {
        status: 'paid',
        amount_paid: 2000,
        currency: 'usd',
        customer: 'cus_123',
        customer_email: 'ada@example.com',
        customer_name: 'Ada Lovelace',
        period_start: 1_700_000_000,
        period_end: 1_700_086_400,
        parent: { subscription_details: { subscription: 'sub_123' } },
        ...invoice,
      },
    },
  } as Stripe.InvoicePaidEvent;
}

function subscriptionEvent(
  type: 'customer.subscription.deleted' | 'customer.subscription.updated',
  subscription: Partial<Stripe.Subscription>,
  previous?: Partial<Stripe.Subscription>
):
  | Stripe.CustomerSubscriptionDeletedEvent
  | Stripe.CustomerSubscriptionUpdatedEvent {
  return {
    id: type === 'customer.subscription.deleted' ? 'evt_deleted' : 'evt_updated',
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
      subscriptionId: 'sub_123',
    });
  });

  test('ignores unpaid checkout sessions', async () => {
    const notification = await notificationFromEvent(
      stripeStub(),
      checkoutEvent({ payment_status: 'unpaid' })
    );
    expect(notification).toBeUndefined();
  });

  test('maps a first invoice after a trial to a payment', async () => {
    const notification = await notificationFromEvent(
      stripeStub({
        subscription: {
          id: 'sub_123',
          trial_end: 1_700_043_200,
        } as Stripe.Subscription,
      }),
      invoicePaidEvent()
    );
    expect(notification).toMatchObject({
      kind: 'payment',
      amount: 2000,
      customer: 'Ada Lovelace (ada@example.com)',
      subscriptionId: 'sub_123',
    });
  });

  test('ignores invoices that are not the first after a trial', async () => {
    const notification = await notificationFromEvent(
      stripeStub({
        subscription: {
          id: 'sub_123',
          trial_end: null,
        } as Stripe.Subscription,
      }),
      invoicePaidEvent()
    );
    expect(notification).toBeUndefined();
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
