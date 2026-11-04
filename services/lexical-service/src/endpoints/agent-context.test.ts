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

  it('composes a run of a routine that fires once', async () => {
    const response = await request({
      promptMarkdown: 'Check whether the deploy finished.',
      trigger: {
        kind: 'routine',
        routine_id: 'r-1',
        name: 'Check back on the deploy',
        owner: { id: 'macro|ada@example.com', name: 'Ada' },
        instructions: 'Report the deploy status in the thread.',
        triggers: [{ type: 'once', at: '2026-10-08T09:00:02Z' }],
        firing: {
          type: 'scheduled',
          scheduled_for: '2026-10-08T09:00:02Z',
          schedule: 'once at 2026-10-08T09:00:02+00:00',
        },
      },
    });
    expect(response.status).toBe(200);
    const { markdown }: { markdown: string } = await response.json();
    expect(markdown).toContain(`once at=\\"2026-10-08T09:00:02Z\\"`);
  });

  it('states the current time the harness sends', async () => {
    const response = await request({
      promptMarkdown: 'what is due today?',
      currentTime: {
        iso: '2026-09-24T16:03:36-04:00',
        local: 'Thursday, September 24, 2026, 4:03 PM',
        timeZone: 'America/New_York',
      },
    });
    expect(response.status).toBe(200);
    const { markdown }: { markdown: string } = await response.json();
    expect(markdown).toContain(`time_zone=\\"America/New_York\\"`);
    expect(markdown).toContain('Thursday, September 24, 2026, 4:03 PM');
  });
});
