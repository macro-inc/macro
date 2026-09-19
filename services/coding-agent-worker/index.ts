import { msg } from '@macro/sdk';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { macro } from './src/macro';
import { startSession } from './src/session';

// "start_agent_session <repo-url> [prompt...]" in any channel the bot can see.
const TRIGGER = /^start_agent_session\s+(\S+)(?:\s+([\s\S]+))?$/;

function normalizeMessageContent(content: string): string {
  return content
    .replaceAll('\\_', '_')
    .replace(/<m-link>(.*?)<\/m-link>/g, (link, json) => {
      try {
        const { url } = JSON.parse(json);
        return typeof url === 'string' ? url : link;
      } catch {
        return link;
      }
    });
}

function repoName(repoUrl: string): string | undefined {
  return repoUrl
    .split('/')
    .filter(Boolean)
    .at(-1)
    ?.replace(/\.git$/, '');
}

const app = new Hono();

app.use(logger());

macro.events.on('channel.message_posted', async ({ metadata, message }) => {
  const content = await message.content();
  console.log('[ingress] channel.message_posted', { metadata, content });
  const match = content && normalizeMessageContent(content).match(TRIGGER);
  if (!match) return;
  const [, repoUrl, prompt] = match;

  const agent = await macro.agents.create({ name: repoName(repoUrl) });
  startSession({
    agentId: agent.id,
    repoUrl,
    prompt: prompt ?? 'Look around the repo and summarize it.',
    onBoot: () => message.reply(msg`${agent} is booted and working`),
  });
  await message.reply(msg`AI flow been started! Check it out: ${agent}`);
});
const receiver = macro.events.webhook();
app.post('/macro-events', (c) => receiver(c.req.raw));

// With the local stack, webhooks arrive through the sdk-webhook-relay's SSH
// reverse tunnel, which delivers to this host port; 8787 otherwise.
export default {
  fetch: app.fetch,
  port: macro._client.localPortmap?.sdkWebhookHostReceiverPort ?? 8787,
};
