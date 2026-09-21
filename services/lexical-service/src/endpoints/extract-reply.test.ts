import '../polyfills/prism';
import { describe, expect, it } from 'bun:test';
import { fromHono } from 'chanfana';
import { Hono } from 'hono';
import { ExtractReplyEndpoint } from './extract-reply';

const app = new Hono();
fromHono(app).post('/extract-reply', ExtractReplyEndpoint);
const request = (markdown: string) =>
  app.request('/extract-reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown }),
  });
const target = {
  targetMessageId: 'message',
  targetThreadId: 'thread',
  displayText: 'hello',
  senderId: 'user',
};

describe('extract reply', () => {
  it('returns the parent of a leading reply target', async () => {
    const parent = { type: 'channel', id: 'channel' };
    const response = await request(
      `<m-reply-target>${JSON.stringify({ parent, ...target })}</m-reply-target>\n\nplease fix`
    );
    expect(response.status).toBe(200);
    expect(await response.json<unknown>()).toEqual({
      reply: { parent, ...target },
    });
  });
  it('reads a channelId-only reply target as a channel parent', async () => {
    const response = await request(
      `<m-reply-target>${JSON.stringify({ channelId: 'channel', ...target })}</m-reply-target>\n\nplease fix`
    );
    expect(response.status).toBe(200);
    expect(await response.json<unknown>()).toEqual({
      reply: { parent: { type: 'channel', id: 'channel' }, ...target },
    });
  });
  it('returns null for a blockquote', async () => {
    const response = await request('> quoted\n\nplease fix');
    expect(response.status).toBe(200);
    expect(await response.json<unknown>()).toEqual({ reply: null });
  });
});
