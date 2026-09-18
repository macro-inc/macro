import '../polyfills/prism';
import { describe, expect, it } from 'bun:test';
import { fromHono } from 'chanfana';
import { Hono } from 'hono';
import { AgentAnnouncementEndpoint } from './agent-announcement';

const app = new Hono();
fromHono(app).post('/agent-announcement', AgentAnnouncementEndpoint);
const request = (body: unknown) =>
  app.request('/agent-announcement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const connectionPrompt = {
  agentTag: '@claude',
  message: 'Connect Claude, then mention me again.',
  chip: { appSlug: 'claude-cloud', name: 'Claude', target: 'harness' },
};

describe('agent announcements', () => {
  it('composes a connection prompt from the client wire format', async () => {
    const response = await request({ connectionPrompt });
    expect(response.status).toBe(200);
    expect(await response.json<{ markdown: string }>()).toEqual({
      markdown:
        '`@claude` Connect Claude, then mention me again. <m-connect-app>{"appSlug":"claude-cloud","name":"Claude","target":"harness"}</m-connect-app>',
    });
  });
  const chip = {
    agentSessionId: 'session',
    promptedMessage: { turn: 0, author: 'user' },
    status: 'booting',
  };
  const chipMarkdown = `<m-magic-chip>${JSON.stringify(chip)}</m-magic-chip>`;
  const target = {
    targetMessageId: 'message',
    targetThreadId: 'thread',
    displayText: 'hello',
    senderId: 'user',
  };
  const replyTargetMarkdown = (parent: { type: string; id: string }) =>
    `<m-reply-target>${JSON.stringify({ parent, ...target })}</m-reply-target>`;

  it('replies to the channel message the harness names as parent', async () => {
    const parent = { type: 'channel', id: 'channel' };
    const response = await request({
      replyTarget: { parent, channelId: 'channel', ...target },
      chip,
    });
    expect(response.status).toBe(200);
    expect(await response.json<{ markdown: string }>()).toEqual({
      markdown: `${replyTargetMarkdown(parent)}\n\n${chipMarkdown}`,
    });
  });
  it('reads a channelId-only reply target as a channel parent', async () => {
    const response = await request({
      replyTarget: { channelId: 'channel', ...target },
      chip,
    });
    expect(response.status).toBe(200);
    expect(await response.json<{ markdown: string }>()).toEqual({
      markdown: `${replyTargetMarkdown({ type: 'channel', id: 'channel' })}\n\n${chipMarkdown}`,
    });
  });
  it('replies to a document comment', async () => {
    const parent = { type: 'document', id: 'doc' };
    const response = await request({
      replyTarget: { parent, ...target },
      chip,
    });
    expect(response.status).toBe(200);
    expect(await response.json<{ markdown: string }>()).toEqual({
      markdown: `${replyTargetMarkdown(parent)}\n\n${chipMarkdown}`,
    });
  });
  it('rejects a reply target without a parent or channel', async () => {
    const response = await request({ replyTarget: target, chip });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
  it('rejects an unknown connection destination', async () => {
    const response = await request({
      connectionPrompt: {
        ...connectionPrompt,
        chip: { ...connectionPrompt.chip, target: 'unknown' },
      },
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});
