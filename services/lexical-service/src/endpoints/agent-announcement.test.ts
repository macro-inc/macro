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
  it('still accepts existing session announcements', async () => {
    const chip = {
      agentSessionId: 'session',
      promptedMessage: { turn: 0, author: 'user' },
      status: 'booting',
    };
    const response = await request({
      replyTarget: {
        parent: { type: 'document', id: 'doc' },
        targetMessageId: 'message',
        targetThreadId: 'thread',
        displayText: 'hello',
        senderId: 'user',
      },
      chip,
    });
    expect(response.status).toBe(200);
    expect(await response.json<{ markdown: string }>()).toEqual({
      markdown: `<m-magic-chip>${JSON.stringify(chip)}</m-magic-chip>`,
    });
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
