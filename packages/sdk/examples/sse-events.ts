import type { Env } from '../src/config';
import type { EventName } from '../src/events/types';
import { Macro } from '../src/macro';

const actAs = process.argv[2];
const botToken = process.env.MACRO_BOT_TOKEN;
if (!actAs || !botToken) {
  console.error(
    'usage: MACRO_BOT_TOKEN=mbot_... bun examples/sse-events.ts <acting-user-id>',
  );
  process.exit(1);
}

const env = (process.env.MACRO_ENV ?? 'dev') as Env;
const bot = new Macro({ env, auth: { type: 'bot', token: botToken } });
const macro = bot.requestedAs(bot.users.byId(actAs));

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

for (const name of ALL_EVENTS) {
  macro.events.on(name, (event) => console.log(name, event.metadata));
}

macro.events.on('document.created', async (e) => {
  const owner = await e.owner.name();
  console.log(
    `  -> ${await e.document.name()} created by ${owner ?? 'someone'}`,
  );
});

macro.events.on('channel.message_posted', async (e) => {
  const from = e.sender ? ((await e.sender.name()) ?? e.sender.id) : 'a bot';
  console.log(`  -> ${from} posted in ${await e.channel.name()}`);
});

const stop = await macro.events.listen();
console.log('listening for events over SSE; Ctrl+C to stop');

const shutdown = () => {
  stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
