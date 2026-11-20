import Stripe from 'stripe';
import type { Env as MacroEnv } from '../../../../packages/sdk/src/config';
import { createChannelBroadcaster } from './channel';
import { formatNotification, notificationFromEvent } from './notification';

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

const cryptoProvider = Stripe.createSubtleCryptoProvider();

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

    try {
      await createChannelBroadcaster({
        botToken: env.MACRO_BOT_TOKEN,
        env: macroEnv,
        storageUrl: env.MACRO_STORAGE_URL,
      })(formatNotification(notification));
    } catch (error) {
      console.error('Failed to post Stripe notification to Macro', error);
      return new Response('Failed to post Stripe notification to Macro', {
        status: 502,
      });
    }

    console.log('Posted Stripe notification', {
      kind: notification.kind,
      eventId: notification.eventId,
      subscriptionId: notification.subscriptionId,
    });
    return Response.json({ ok: true });
  },
};
