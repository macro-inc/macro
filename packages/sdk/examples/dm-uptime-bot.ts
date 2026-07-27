/**
 * A tiny DM bot: opens a DM with a user, says hi, reacts to and replies to
 * its own message, then posts its uptime every 10 seconds until killed.
 *
 * Usage:
 *   MACRO_BOT_TOKEN=mbot_... bun examples/dm-uptime-bot.ts '<macro-user-id>'
 *
 * Set MACRO_ACT_AS to a user id (the bot's owner, or a member of its owning
 * team) to act on behalf of that user instead of team scope.
 * Set MACRO_ENV to 'dev' (default), 'prod', or 'local' to pick the backend.
 */
import type { Env } from '../src/config';
import { Macro } from '../src/macro';

const recipientId = process.argv[2];
if (!recipientId) {
  console.error('usage: bun examples/dm-uptime-bot.ts <macro-user-id>');
  process.exit(1);
}

const botToken = process.env.MACRO_BOT_TOKEN;
if (!botToken) {
  console.error('set MACRO_BOT_TOKEN to a bot API key (mbot_...)');
  process.exit(1);
}

const env = (process.env.MACRO_ENV ?? 'dev') as Env;
let macro = new Macro({ env, auth: { type: 'bot', token: botToken } });
const actAs = process.env.MACRO_ACT_AS;
if (actAs) macro = macro.requestedAs(actAs);

const dm = await macro.channels.dm(macro.users.byId(recipientId));
console.log(`dm open: ${dm.webUrl()}`);

const hello = await dm.send('hello! 👋 starting up.');
await hello.react('😊');
await hello.reply("i'll post my uptime here every 10 seconds.");

const startedAt = Date.now();
setInterval(async () => {
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  try {
    await dm.send(`⏱ up for ${seconds}s`);
    console.log(`sent uptime: ${seconds}s`);
  } catch (e) {
    console.error('failed to send uptime message:', e);
  }
}, 10_000);
