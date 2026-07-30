// Register a webhook, fire a signed validation delivery at it right away,
// and print the result for use elsewhere (id + signing secret).
//
// usage: MACRO_BOT_TOKEN=mbot_... bun scripts/setup-webhook.ts <url> [event ...]
//        (events default to channel.message_posted; MACRO_ENV picks the env)

import type { Env } from '../src/config';
import type { EventName } from '../src/events/types';
import { Macro } from '../src/macro';

const [url, ...eventArgs] = process.argv.slice(2);
if (!url) {
  console.error('usage: bun scripts/setup-webhook.ts <url> [event ...]');
  process.exit(1);
}

const env = (process.env.MACRO_ENV ?? 'dev') as Env;
const events = (
  eventArgs.length ? eventArgs : ['channel.message_posted']
) as EventName[];

const macro = new Macro({ env });

const webhook = await macro.webhooks.create({
  url,
  name: 'sdk setup-webhook',
  filters: [{ events }],
});
console.log(`created webhook ${webhook.id} → ${url} (${events.join(', ')})`);

// A signed test delivery: proves the tunnel is up and the endpoint acks.
const result = await webhook.validate();
if (result.is_valid) {
  console.log('validation delivery accepted ✔');
} else {
  console.error(
    `validation failed: ${result.message ?? 'endpoint did not accept the delivery'}`,
  );
}

console.log('\nfor your use:');
console.log(`  webhook id:            ${webhook.id}`);
console.log(
  `  MACRO_WEBHOOK_SECRET=${webhook.signingSecret ?? '<not returned>'}`,
);

process.exit(result.is_valid ? 0 : 1);
