import Stripe from 'stripe';

export type PaymentNotification = {
  kind: 'payment';
  amount: number;
  currency: string;
  customer: string;
  eventId: string;
  livemode: boolean;
  subscriptionId?: string;
};

export type CancellationNotification = {
  kind: 'cancellation';
  customer: string;
  eventId: string;
  livemode: boolean;
  subscriptionId: string;
  timing: 'scheduled' | 'ended';
  endsAt?: number;
  reason?: string;
  feedback?: string;
  comment?: string;
};

export type StripeNotification = PaymentNotification | CancellationNotification;

function customerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
): string | undefined {
  return typeof customer === 'string' ? customer : customer?.id;
}

function subscriptionId(
  subscription: string | Stripe.Subscription | null
): string | undefined {
  return typeof subscription === 'string' ? subscription : subscription?.id;
}

function customerLabel(
  name?: string | null,
  email?: string | null,
  fallback?: string | null
): string {
  if (email && name) return `${name} (${email})`;
  return email ?? name ?? fallback ?? 'Unknown customer';
}

function fromExpandedCustomer(
  customer: Stripe.Customer | Stripe.DeletedCustomer
): string {
  if ('deleted' in customer && customer.deleted) return customer.id;
  return customerLabel(customer.name, customer.email, customer.id);
}

async function resolveCustomer(
  stripe: Stripe,
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
): Promise<string> {
  if (customer && typeof customer === 'object') {
    return fromExpandedCustomer(customer);
  }
  if (typeof customer === 'string') {
    const retrieved = await stripe.customers.retrieve(customer);
    return fromExpandedCustomer(retrieved);
  }
  return 'Unknown customer';
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ');
}

function checkoutPayment(
  event:
    | Stripe.CheckoutSessionCompletedEvent
    | Stripe.CheckoutSessionAsyncPaymentSucceededEvent
): PaymentNotification | undefined {
  const session = event.data.object;
  if (
    session.payment_status !== 'paid' ||
    session.amount_total === null ||
    session.currency === null
  ) {
    return undefined;
  }

  const expandedCustomer =
    typeof session.customer === 'object' &&
    session.customer !== null &&
    !('deleted' in session.customer)
      ? session.customer
      : undefined;
  const email =
    session.customer_details?.email ??
    session.customer_email ??
    expandedCustomer?.email;
  const name = session.customer_details?.name ?? expandedCustomer?.name;

  return {
    kind: 'payment',
    amount: session.amount_total,
    currency: session.currency,
    customer: customerLabel(name, email, customerId(session.customer)),
    eventId: event.id,
    livemode: event.livemode,
    subscriptionId: subscriptionId(session.subscription),
  };
}

async function postTrialPayment(
  stripe: Stripe,
  event: Stripe.InvoicePaidEvent
): Promise<PaymentNotification | undefined> {
  const invoice = event.data.object;
  if (invoice.status !== 'paid' || invoice.amount_paid <= 0) return undefined;

  const legacyInvoice = invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  };
  const subscriptionRef =
    invoice.parent?.subscription_details?.subscription ??
    legacyInvoice.subscription;
  if (!subscriptionRef) return undefined;

  const subscription =
    typeof subscriptionRef === 'string'
      ? await stripe.subscriptions.retrieve(subscriptionRef)
      : subscriptionRef;
  const trialEnd = subscription.trial_end;
  const fiveMinutes = 5 * 60;
  if (
    trialEnd === null ||
    trialEnd < invoice.period_start - fiveMinutes ||
    trialEnd > invoice.period_end + fiveMinutes
  ) {
    return undefined;
  }

  return {
    kind: 'payment',
    amount: invoice.amount_paid,
    currency: invoice.currency,
    customer: customerLabel(
      invoice.customer_name,
      invoice.customer_email,
      customerId(invoice.customer)
    ),
    eventId: event.id,
    livemode: event.livemode,
    subscriptionId: subscription.id,
  };
}

function cancellationDetails(subscription: Stripe.Subscription): {
  endsAt?: number;
  reason?: string;
  feedback?: string;
  comment?: string;
} {
  const details = subscription.cancellation_details;
  return {
    endsAt: subscription.cancel_at ?? undefined,
    reason: details?.reason ?? undefined,
    feedback: details?.feedback ?? undefined,
    comment: details?.comment ?? undefined,
  };
}

async function cancellationFromSubscription(
  stripe: Stripe,
  event:
    | Stripe.CustomerSubscriptionDeletedEvent
    | Stripe.CustomerSubscriptionUpdatedEvent,
  timing: CancellationNotification['timing']
): Promise<CancellationNotification> {
  const subscription = event.data.object;
  return {
    kind: 'cancellation',
    customer: await resolveCustomer(stripe, subscription.customer),
    eventId: event.id,
    livemode: event.livemode,
    subscriptionId: subscription.id,
    timing,
    ...cancellationDetails(subscription),
  };
}

function isNewlyScheduledCancel(
  event: Stripe.CustomerSubscriptionUpdatedEvent
): boolean {
  return (
    event.data.object.cancel_at_period_end &&
    event.data.previous_attributes?.cancel_at_period_end === false
  );
}

export async function notificationFromEvent(
  stripe: Stripe,
  event: Stripe.Event
): Promise<StripeNotification | undefined> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return checkoutPayment(event);
    case 'invoice.paid':
      return postTrialPayment(stripe, event);
    case 'customer.subscription.deleted':
      return cancellationFromSubscription(stripe, event, 'ended');
    case 'customer.subscription.updated':
      if (!isNewlyScheduledCancel(event)) return undefined;
      return cancellationFromSubscription(stripe, event, 'scheduled');
    default:
      return undefined;
  }
}

function formatAmount(amount: number, currency: string): string {
  const code = currency.toUpperCase();
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code,
  });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return `${formatter.format(amount / 10 ** fractionDigits)} ${code}`;
}

function dashboardEventUrl(livemode: boolean, eventId: string): string {
  const prefix = livemode ? '' : 'test/';
  return `https://dashboard.stripe.com/${prefix}events/${eventId}`;
}

function formatUnixDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function formatPayment(payment: PaymentNotification): string {
  const lines = [
    '💸 New Stripe payment',
    `Customer: ${payment.customer}`,
    `Amount: ${formatAmount(payment.amount, payment.currency)}`,
  ];
  if (payment.subscriptionId) {
    lines.push(`Subscription: ${payment.subscriptionId}`);
  }
  lines.push(dashboardEventUrl(payment.livemode, payment.eventId));
  return lines.join('\n');
}

function formatCancellation(cancellation: CancellationNotification): string {
  const title =
    cancellation.timing === 'scheduled'
      ? '🚫 Stripe subscription cancellation scheduled'
      : '🚫 Stripe subscription canceled';
  const lines = [title, `Customer: ${cancellation.customer}`];
  if (cancellation.timing === 'scheduled' && cancellation.endsAt) {
    lines.push(`Ends: ${formatUnixDate(cancellation.endsAt)}`);
  }
  if (cancellation.reason) {
    lines.push(`Reason: ${humanize(cancellation.reason)}`);
  }
  if (cancellation.feedback) {
    lines.push(`Feedback: ${humanize(cancellation.feedback)}`);
  }
  if (cancellation.comment) {
    lines.push(`Comment: ${cancellation.comment}`);
  }
  lines.push(`Subscription: ${cancellation.subscriptionId}`);
  lines.push(dashboardEventUrl(cancellation.livemode, cancellation.eventId));
  return lines.join('\n');
}

export function formatNotification(notification: StripeNotification): string {
  switch (notification.kind) {
    case 'payment':
      return formatPayment(notification);
    case 'cancellation':
      return formatCancellation(notification);
    default: {
      const _exhaustive: never = notification;
      return _exhaustive;
    }
  }
}
