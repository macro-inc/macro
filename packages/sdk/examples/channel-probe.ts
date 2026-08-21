/**
 * Probe which channel operations a bot API key can perform, acting as a user.
 * Tries: post message → react 😊 → thread reply, reporting each step.
 *
 * Usage:
 *   MACRO_BOT_TOKEN=mbot_... bun examples/channel-probe.ts <channel-id> <acting-user-id>
 *
 * The acting user must be a member of the channel (access is theirs; the
 * message is attributed to the bot). Set MACRO_ENV for dev/prod/local.
 */
import type { Env } from '../src/config';
import { Macro } from '../src/macro';

const [channelId, actAs] = process.argv.slice(2);
const botToken = process.env.MACRO_BOT_TOKEN;
if (!channelId || !actAs || !botToken) {
  console.error(
    'usage: MACRO_BOT_TOKEN=mbot_... bun examples/channel-probe.ts <channel-id> <acting-user-id>',
  );
  process.exit(1);
}

const env = (process.env.MACRO_ENV ?? 'dev') as Env;
const bot = new Macro({ env, auth: { type: 'bot', token: botToken } });
const macro = bot.requestedAs(bot.users.byId(actAs));
const channel = macro.channels.byId(channelId);

async function step<T>(name: string, run: () => Promise<T>): Promise<T | null> {
  try {
    const result = await run();
    console.log(`✔ ${name}`);
    return result;
  } catch (e) {
    console.log(`✘ ${name}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

const message = await step('post message', () =>
  channel.send(`bot probe 👋 (acting as ${actAs})`),
);
if (message) {
  await step('react 😊', () => message.react('😊'));
  await step('thread reply', () => message.reply('reply from the bot'));
}
