import { createAlertChannel } from './channel';
import { createApp } from './index';
import { createMemoryAlertStore } from './store';

const PORT = parseInt(process.env.PORT || '8089', 10);

const requiredVars = [
  'BOT_TOKEN',
  'CHANNEL_ID',
  'ACTING_USER_ID',
  'WEBHOOK_SECRET',
] as const;
for (const varName of requiredVars) {
  if (!process.env[varName]) {
    console.error(`Missing required environment variable: ${varName}`);
    process.exit(1);
  }
}

const app = createApp({
  webhookSecret: process.env.WEBHOOK_SECRET!,
  channel: createAlertChannel({
    channelId: process.env.CHANNEL_ID!,
    botToken: process.env.BOT_TOKEN!,
    actingUserId: process.env.ACTING_USER_ID!,
    env: (process.env.MACRO_ENV as 'prod' | 'dev' | 'local') || 'prod',
  }),
  store: createMemoryAlertStore(),
});

const server = Bun.serve({
  port: PORT,
  fetch: app.fetch,
});

console.log(`goalert-bot listening on http://localhost:${server.port}`);
