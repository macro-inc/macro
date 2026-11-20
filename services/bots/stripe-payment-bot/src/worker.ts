import Stripe from 'stripe';
import type { Env as MacroEnv } from '../../../../packages/sdk/src/config';
import {
  broadcast,
  type ChannelBindings,
  type InvoiceDeliveries,
} from './channel';

export { InvoiceDelivery } from './delivery';

import { formatNotification, notificationFromEvent } from './notification';

type WorkerEnv = ChannelBindings & {
  INVOICE_DELIVERIES: InvoiceDeliveries;
  STRIPE_API_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
};

const REQUIRED_BINDINGS: readonly (keyof WorkerEnv)[] = [
  'INVOICE_DELIVERIES',
  'MACRO_BOT_TOKEN',
  'MACRO_ENV',
  'STRIPE_API_KEY',
  'STRIPE_WEBHOOK_SECRET',
];

const MACRO_ENVIRONMENTS: readonly MacroEnv[] = ['dev', 'prod', 'local'];

const cryptoProvider = Stripe.createSubtleCryptoProvider();

function missingBindings(env: WorkerEnv): string[] {
  return REQUIRED_BINDINGS.filter((key) => !env[key]);
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

    if (!MACRO_ENVIRONMENTS.includes(env.MACRO_ENV)) {
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

    let notification;
    try {
      notification = await notificationFromEvent(stripe, event);
    } catch (error) {
      console.error('Failed to load Stripe notification details', error);
      return new Response('Failed to load Stripe notification details', {
        status: 502,
      });
    }
    if (!notification) return Response.json({ ok: true, ignored: true });

    const invoiceId =
      notification.kind === 'payment' ? notification.invoice?.id : undefined;
    try {
      const channelCount = await broadcast(
        env,
        formatNotification(notification),
        invoiceId
      );
      console.log('Posted Stripe notification', {
        kind: notification.kind,
        eventId: notification.eventId,
        subscriptionId: notification.subscriptionId,
        invoiceId,
        channelCount,
      });
    } catch (error) {
      console.error('Failed to post Stripe notification to Macro', error);
      return new Response('Failed to post Stripe notification to Macro', {
        status: 502,
      });
    }

    return Response.json({ ok: true });
  },
};
