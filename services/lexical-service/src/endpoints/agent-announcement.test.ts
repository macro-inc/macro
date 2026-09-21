import '../polyfills/prism';
import { describe, expect, it } from 'bun:test';
import { readReplyTargetData } from '@macro-inc/lexical-core/nodes/ReplyTargetNode';
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
  const replyTarget = {
    targetMessageId: 'message',
    targetThreadId: 'thread',
    displayText: 'hello',
    senderId: 'user',
  };
  /** The reply target exactly as the editor's parser reads it back. */
  const parsedReplyTarget = (markdown: string) => {
    const match = markdown.match(/^<m-reply-target>(.*?)<\/m-reply-target>/s);
    if (!match?.[1]) throw new Error(`no reply target in ${markdown}`);
    return readReplyTargetData(JSON.parse(match[1]));
  };
  it('announces under the parent the reply lives in', async () => {
    const parent = { type: 'document' as const, id: 'doc' };
    const response = await request({
      replyTarget: { parent, ...replyTarget },
      chip,
    });
    expect(response.status).toBe(200);
    const { markdown } = await response.json<{ markdown: string }>();
    // Shipped broken once: the endpoint built the node from a `channelId`
    // the node no longer had, and every announcement rendered as an
    // unknown reply target. The parser, not the string, is the oracle.
    expect(parsedReplyTarget(markdown)).toEqual({ parent, ...replyTarget });
    expect(markdown).toEndWith(
      `<m-magic-chip>${JSON.stringify(chip)}</m-magic-chip>`
    );
  });
  it('still accepts a channel named the way callers used to', async () => {
    const response = await request({
      replyTarget: { channelId: 'chan', ...replyTarget },
      chip,
    });
    expect(response.status).toBe(200);
    const { markdown } = await response.json<{ markdown: string }>();
    expect(parsedReplyTarget(markdown)).toEqual({
      parent: { type: 'channel', id: 'chan' },
      ...replyTarget,
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
