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
    const { markdown }: { markdown: string } = await response.json();
    expect(markdown).toContain(`conversation type=\\"${type}\\"`);
  });

  it('composes a turn of a private conversation', async () => {
    const response = await request({
      promptMarkdown: 'what changed?',
      trigger: {
        kind: 'conversation',
        surface: {
          type: 'channel',
          id: 'dm-1',
          channel_type: 'direct_message',
        },
        prompt_message_id: 'm-1',
        sender: { id: 'macro|ada@example.com', name: 'Ada' },
        reply_target: { kind: 'none' },
      },
    });
    expect(response.status).toBe(200);
    const { markdown }: { markdown: string } = await response.json();
    expect(markdown).toContain(`trigger kind=\\"conversation\\"`);
    expect(markdown).toContain('your private conversation with the user');
  });
});
