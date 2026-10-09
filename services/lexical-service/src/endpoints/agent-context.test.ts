import '../polyfills/prism';
import { describe, expect, it } from 'bun:test';
import { fromHono } from 'chanfana';
import { Hono } from 'hono';
import { AgentContextEndpoint } from './agent-context';

const app = new Hono();
fromHono(app).post('/agent-context', AgentContextEndpoint);
const request = (body: unknown) =>
  app.request('/agent-context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('agent context', () => {
  it.each([
    'channel',
    'document',
    'initiative',
    'crm_company',
    'crm_contact',
    'call',
  ])('composes a prompt posted on a %s parent', async (type) => {
    const response = await request({
      promptMarkdown: 'tell me more',
      parent: { type, id: 'parent-1' },
    });
    expect(response.status).toBe(200);
    const { markdown } = await response.json<{ markdown: string }>();
    expect(markdown).toContain(`conversation type=\\"${type}\\"`);
  });

  it('accepts and keeps a private conversation marker', async () => {
    const response = await request({
      promptMarkdown: 'what changed?',
      parent: { type: 'channel', id: 'dm-1' },
      directMessage: true,
    });
    expect(response.status).toBe(200);
    const { markdown } = await response.json<{ markdown: string }>();
    expect(markdown).toContain('your private conversation with the user');
  });
});
