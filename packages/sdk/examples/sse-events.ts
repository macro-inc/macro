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
  'channel.participant_added',
  'channel.participant_removed',
  'channel.updated',
  'document.copied',
  'document.created',
  'document.deleted',
  'document.updated',
  'message.attachment_created',
  'message.attachment_removed',
  'message.deleted',
  'message.mentioned',
  'message.patched',
  'message.posted',
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

macro.events.on('message.posted', async (e) => {
  const from = e.sender ? ((await e.sender.name()) ?? e.sender.id) : 'a bot';
  const where =
    e.target.type === 'channel'
      ? `in ${await e.target.channel.name()}`
      : `on ${await e.target.document.name()}`;
  console.log(`  -> ${from} posted ${where}`);
});

const stop = await macro.events.listen();
console.log('listening for events over SSE; Ctrl+C to stop');

const shutdown = () => {
  stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
