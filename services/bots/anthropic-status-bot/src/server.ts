import { createChannelPoster } from './channel';
import { createApp } from './index';

const PORT = parseInt(process.env.PORT || '8088', 10);

const requiredVars = ['BOT_TOKEN', 'CHANNEL_ID', 'WEBHOOK_SECRET'] as const;
for (const varName of requiredVars) {
  if (!process.env[varName]) {
    console.error(`Missing required environment variable: ${varName}`);
    process.exit(1);
  }
}

const app = createApp({
  webhookSecret: process.env.WEBHOOK_SECRET!,
  postToChannel: createChannelPoster({
    channelId: process.env.CHANNEL_ID!,
    botToken: process.env.BOT_TOKEN!,
    env: (process.env.MACRO_ENV as 'prod' | 'dev' | 'local') || 'prod',
  }),
});

const server = Bun.serve({
  port: PORT,
  fetch: app.fetch,
});

console.log(
  `anthropic-status-bot listening on http://localhost:${server.port}`
);
