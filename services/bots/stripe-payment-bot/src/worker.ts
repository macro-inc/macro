import Stripe from 'stripe';
import type { Env as MacroEnv } from '../../../../packages/sdk/src/config';
import { createChannelBroadcaster } from './channel';

type WorkerEnv = {
  MACRO_BOT_TOKEN: string;
  MACRO_ENV: string;
  MACRO_STORAGE_URL?: string;
  STRIPE_API_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
};

const REQUIRED_BINDINGS: readonly (keyof WorkerEnv)[] = [
  'MACRO_BOT_TOKEN',
  'MACRO_ENV',
  'STRIPE_API_KEY',
  'STRIPE_WEBHOOK_SECRET',
];

const MACRO_ENVIRONMENTS: readonly MacroEnv[] = ['dev', 'prod', 'local'];

type Payment = {
  amount: number;
  currency: string;
  customer: string;
  eventId: string;
  livemode: boolean;
  subscriptionId?: string;
};

const cryptoProvider = Stripe.createSubtleCryptoProvider();

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

function checkoutPayment(
  event:
    | Stripe.CheckoutSessionCompletedEvent
    | Stripe.CheckoutSessionAsyncPaymentSucceededEvent
): Payment | undefined {
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
    amount: session.amount_total,
    currency: session.currency,
    customer:
      email && name
        ? `${name} (${email})`
        : (email ?? name ?? customerId(session.customer) ?? 'Unknown customer'),
    eventId: event.id,
    livemode: event.livemode,
    subscriptionId: subscriptionId(session.subscription),
  };
}

async function postTrialPayment(
  stripe: Stripe,
  event: Stripe.InvoicePaidEvent
): Promise<Payment | undefined> {
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
    amount: invoice.amount_paid,
    currency: invoice.currency,
    customer:
      invoice.customer_email && invoice.customer_name
        ? `${invoice.customer_name} (${invoice.customer_email})`
        : (invoice.customer_email ??
          invoice.customer_name ??
          customerId(invoice.customer) ??
          'Unknown customer'),
    eventId: event.id,
    livemode: event.livemode,
    subscriptionId: subscription.id,
  };
}

async function paymentFromEvent(
  stripe: Stripe,
  event: Stripe.Event
): Promise<Payment | undefined> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return checkoutPayment(event);
    case 'invoice.paid':
      return postTrialPayment(stripe, event);
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

function formatPayment(payment: Payment): string {
  const dashboardPrefix = payment.livemode ? '' : 'test/';
  const lines = [
    '💸 New Stripe payment',
    `Customer: ${payment.customer}`,
    `Amount: ${formatAmount(payment.amount, payment.currency)}`,
  ];
  if (payment.subscriptionId) {
    lines.push(`Subscription: ${payment.subscriptionId}`);
  }
  lines.push(
    `https://dashboard.stripe.com/${dashboardPrefix}events/${payment.eventId}`
  );
  return lines.join('\n');
}

function missingBindings(env: WorkerEnv): string[] {
  return REQUIRED_BINDINGS.filter((key) => !env[key]);
}

function parseMacroEnv(value: string): MacroEnv | undefined {
  return MACRO_ENVIRONMENTS.find((environment) => environment === value);
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true });
    }
    if (request.method !== 'POST' || url.pathname !== '/webhook') {
      return new Response('Not found', { status: 404 });
    }

    const missing = missingBindings(env);
    if (missing.length > 0) {
      return Response.json(
        { error: `missing worker bindings: ${missing.join(', ')}` },
        { status: 500 }
      );
    }

    const macroEnv = parseMacroEnv(env.MACRO_ENV);
    if (!macroEnv) {
      return Response.json(
        {
          error: `MACRO_ENV must be one of: ${MACRO_ENVIRONMENTS.join(', ')}`,
        },
        { status: 500 }
      );
    }

    const signature = request.headers.get('stripe-signature');
    if (!signature) {
      return new Response('Missing Stripe-Signature header', { status: 400 });
    }

    const stripe = new Stripe(env.STRIPE_API_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
    });
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(
        await request.text(),
        signature,
        env.STRIPE_WEBHOOK_SECRET,
        undefined,
        cryptoProvider
      );
    } catch (error) {
      console.error('Invalid Stripe webhook', error);
      return new Response('Invalid Stripe webhook', { status: 400 });
    }

    let payment: Payment | undefined;
    try {
      payment = await paymentFromEvent(stripe, event);
    } catch (error) {
      console.error('Failed to load Stripe payment details', error);
      return new Response('Failed to load Stripe payment details', {
        status: 502,
      });
    }
    if (!payment) return Response.json({ ok: true, ignored: true });

    try {
      await createChannelBroadcaster({
        botToken: env.MACRO_BOT_TOKEN,
        env: macroEnv,
        storageUrl: env.MACRO_STORAGE_URL,
      })(formatPayment(payment));
    } catch (error) {
      console.error('Failed to post Stripe payment to Macro', error);
      return new Response('Failed to post Stripe payment to Macro', {
        status: 502,
      });
    }

    console.log('Posted Stripe payment', {
      eventId: payment.eventId,
      subscriptionId: payment.subscriptionId,
    });
    return Response.json({ ok: true });
  },
};
