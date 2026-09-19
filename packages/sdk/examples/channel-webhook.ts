/**
 * Post to a channel using a webhook token copied out of the Macro web UI.
 *
 * The token is an ordinary bot token, so this is just `channel.send()` — the
 * SDK works out that the credential can only reach the webhook endpoint and
 * routes there. Mentions still land, because `msg` embeds `<m-*>` tags in the
 * content and the backend parses them back out.
 *
 * usage: MACRO_WEBHOOK_TOKEN=mbot_... bun examples/channel-webhook.ts <channel-id> [mention-user-id]
 */
import { Env } from '../src/config';
import { here, Macro, msg } from '../src/macro';

const token = process.env.MACRO_WEBHOOK_TOKEN;
const [channelId, mentionUserId] = process.argv.slice(2);

if (!token || !channelId) {
  console.error(
    'usage: MACRO_WEBHOOK_TOKEN=mbot_... bun examples/channel-webhook.ts <channel-id> [mention-user-id]',
  );
  process.exit(1);
}

const macro = new Macro({
  env: (process.env.MACRO_ENV ?? 'dev') as Env,
  auth: { type: 'bot', token },
});
const channel = macro.channels.byId(channelId);

// Plain text.
await channel.send('Build started.');

// Rich framing. `macro.users.byId` is a lazy handle — no request is made just
// to mention someone.
const target = mentionUserId ? macro.users.byId(mentionUserId) : here;
const sent = await channel.send(
  msg`Build **passed** on \`main\`. Nice work ${target}.`,
);

const self = await macro.bots.me();
console.log(`posted ${sent.id} as ${self.name} (${self.owner?.type}-owned)`);
