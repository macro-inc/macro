import { createChannelPoster } from './channel';
import { createApp } from './index';

/**
 * Cloudflare Worker entrypoint. Config comes from worker bindings
 * (vars + secrets); see wrangler.jsonc. For local development outside
 * wrangler, src/server.ts provides the same app under Bun.
 */
type Env = {
  BOT_TOKEN: string;
  CHANNEL_ID: string;
  WEBHOOK_SECRET: string;
};

const REQUIRED: readonly (keyof Env)[] = [
  'BOT_TOKEN',
  'CHANNEL_ID',
  'WEBHOOK_SECRET',
];

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const missing = REQUIRED.filter((key) => !env[key]);
    if (missing.length > 0) {
      return Response.json(
        { error: `missing worker bindings: ${missing.join(', ')}` },
        { status: 500 }
      );
    }

    const app = createApp({
      webhookSecret: env.WEBHOOK_SECRET!,
      postToChannel: createChannelPoster({
        channelId: env.CHANNEL_ID!,
        botToken: env.BOT_TOKEN!,
        env: 'prod',
      }),
    });

    return app.fetch(request, env);
  },
};
