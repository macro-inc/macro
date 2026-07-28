import type { Env } from '../src/config';
import type { EventName } from '../src/events/types';
import { Macro } from '../src/macro';

const [url, actAs] = process.argv.slice(2);
const botToken = process.env.MACRO_BOT_TOKEN;
if (!url || !actAs || !botToken) {
  console.error(
    'usage: MACRO_BOT_TOKEN=mbot_... bun examples/webhook-events.ts <public-url> <acting-user-id>',
  );
  process.exit(1);
}

const env = (process.env.MACRO_ENV ?? 'dev') as Env;
const port = Number(process.env.PORT ?? 8787);
const macro = new Macro({
  env,
  auth: { type: 'bot', token: botToken },
}).requestedAs(actAs);

// `as const` keeps the literal types so `.on()` infers each event's payload;
// `satisfies` makes a typo in this list a compile error.
const ALL_EVENTS = [
  'channel.created',
  'channel.deleted',
  'channel.message_attachment_created',
  'channel.message_attachment_removed',
  'channel.message_deleted',
  'channel.message_patched',
  'channel.message_posted',
  'channel.participant_added',
  'channel.participant_removed',
  'channel.updated',
  'document.copied',
  'document.created',
  'document.deleted',
  'document.updated',
] as const satisfies readonly EventName[];

// Filled in once registration returns the signing secret; until then (i.e.
// for the registration-time validation ping) deliveries are acked unverified.
let receiver: ((req: Request) => Promise<Response>) | null = null;

Bun.serve({
  port,
  fetch: async (req) => {
    if (!receiver) {
      console.log(`[unverified] ${req.headers.get('x-macro-event')}`);
      return new Response('ok');
    }
    try {
      return await receiver(req);
    } catch (e) {
      console.error('[bad signature]', e);
      return new Response('invalid signature', { status: 401 });
    }
  },
});
console.log(`listening on :${port} — expose it with: ngrok http ${port}`);

const webhook = await macro.webhooks.create({
  url,
  name: 'sdk webhook demo',
  filters: [{ events: [...ALL_EVENTS] }],
});

const secret = webhook.signingSecret;
if (!secret)
  throw new Error('webhook registered but no signing secret returned');

console.log(`webhook ${webhook.id} registered for ${url}, waiting for events`);

const events = new Macro({
  env,
  auth: { type: 'bot', token: botToken },
  webhookSecret: secret,
}).events;

for (const name of ALL_EVENTS) {
  events.on(name, (event) => console.log(name, event.metadata));
}
receiver = events.webhook();
