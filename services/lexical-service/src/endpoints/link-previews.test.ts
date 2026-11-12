import '../polyfills/prism';
import { describe, expect, it } from 'bun:test';
import { fromHono } from 'chanfana';
import { Hono } from 'hono';
import { LinkPreviewsEndpoint } from './link-previews';

const app = new Hono();
fromHono(app).post('/link-previews', LinkPreviewsEndpoint);

describe('link previews', () => {
  it('returns the links a message shows cards for', async () => {
    const response = await app.request('/link-previews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markdown:
          'Read https://example.com/post, not `https://code.example.com`',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      urls: ['https://example.com/post'],
    });
  });
});
