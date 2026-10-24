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
  agentTag: '@codex',
  message: 'Connect Codex, then mention me again.',
  chip: { appSlug: 'codex-cloud', name: 'Codex', target: 'harness' },
};

describe('agent announcements', () => {
  it('composes a connection prompt from the client wire format', async () => {
    const response = await request({ connectionPrompt });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      markdown:
        '`@codex` Connect Codex, then mention me again. <m-connect-app>{"appSlug":"codex-cloud","name":"Codex","target":"harness"}</m-connect-app>',
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
  it('announces an assignment as a chip without a user reply target', async () => {
    const response = await request({ chip });
    expect(response.status).toBe(200);
    const { markdown }: { markdown: string } = await response.json();
    expect(markdown).toBe(
      `<m-magic-chip>${JSON.stringify(chip)}</m-magic-chip>`
    );
    expect(markdown).not.toContain('m-reply-target');
  });
  it.each([
    'channel',
    'document',
    'initiative',
    'crm_company',
    'crm_contact',
    'call',
  ])('announces under the %s parent the reply lives in', async (type) => {
    const parent = { type, id: 'parent-1' };
    const response = await request({
      replyTarget: { parent, ...replyTarget },
      chip,
    });
    expect(response.status).toBe(200);
    const { markdown }: { markdown: string } = await response.json();
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
    const { markdown }: { markdown: string } = await response.json();
    expect(parsedReplyTarget(markdown)).toEqual({
      parent: { type: 'channel', id: 'chan' },
      ...replyTarget,
    });
  });
  it('composes a chat reply as the session link over its body', async () => {
    const link =
      '<m-agent-session-mention>{"id":"session","label":"Agent session"}</m-agent-session-mention>';
    const pending = await request({
      chatReply: { sessionId: 'session', body: { kind: 'pending' } },
    });
    expect(pending.status).toBe(200);
    const { markdown: spinner }: { markdown: string } = await pending.json();
    expect(spinner.startsWith(`${link}\n\n<m-await>`)).toBe(true);
    expect(spinner.endsWith('</m-await>')).toBe(true);
    const answered = await request({
      chatReply: {
        sessionId: 'session',
        body: { kind: 'markdown', markdown: 'Sure.\n\n- done' },
      },
    });
    expect(await answered.json()).toEqual({
      markdown: `${link}\n\nSure.\n\n- done`,
    });
  });
  it('composes a private reply from segments, with steps as a live node', async () => {
    const response = await request({
      chatReply: {
        sessionId: 'session',
        link: false,
        body: {
          kind: 'segments',
          segments: [
            { kind: 'prose', markdown: 'Checking first.' },
            {
              kind: 'activity',
              turn: 2,
              segment: 1,
              sealed: true,
              rows: [
                { id: 't1', label: 'Ran', detail: 'ls', status: 'completed' },
                { id: 't2', label: 'Read', detail: null, status: 'completed' },
              ],
            },
          ],
          footer: null,
        },
      },
    });
    expect(response.status).toBe(200);
    const { markdown }: { markdown: string } = await response.json();
    expect(markdown).toBe(
      'Checking first.\n\n<m-agent-activity>{"agentSessionId":"session","turn":2,"segment":1,"rows":[{"id":"t1","label":"Ran","status":"completed","detail":"ls"},{"id":"t2","label":"Read","status":"completed"}],"sealed":true}</m-agent-activity>'
    );
  });
  it('keeps what a step produced as its card', async () => {
    const card = {
      kind: 'item',
      itemType: 'document',
      itemId: 'doc-1',
      fileType: 'md',
      action: 'created',
      title: 'Launch FAQ',
    };
    const response = await request({
      chatReply: {
        sessionId: 'session',
        link: false,
        body: {
          kind: 'segments',
          segments: [
            {
              kind: 'activity',
              turn: 2,
              segment: 0,
              sealed: true,
              rows: [
                {
                  id: 't1',
                  label: 'Create document',
                  detail: 'Launch FAQ',
                  status: 'completed',
                  card,
                },
              ],
            },
          ],
        },
      },
    });
    expect(response.status).toBe(200);
    const { markdown }: { markdown: string } = await response.json();
    expect(markdown).toBe(
      `<m-agent-activity>{"agentSessionId":"session","turn":2,"segment":0,"rows":[{"id":"t1","label":"Create document","status":"completed","detail":"Launch FAQ","card":${JSON.stringify(card)}}],"sealed":true}</m-agent-activity>`
    );
  });

  it('keeps a database answer the agent asked to show', async () => {
    const cards = [
      { kind: 'data', sql: 'SELECT 1', databaseId: null, display: 'table' },
    ];
    const response = await request({
      chatReply: {
        sessionId: 'session',
        link: false,
        body: {
          kind: 'segments',
          segments: [
            {
              kind: 'activity',
              turn: 2,
              segment: 0,
              sealed: true,
              rows: cards.map((card, index) => ({
                id: `t${index}`,
                label: 'Searched',
                status: 'completed',
                card,
              })),
            },
          ],
        },
      },
    });
    expect(response.status).toBe(200);
    const { markdown }: { markdown: string } = await response.json();
    for (const card of cards) expect(markdown).toContain(JSON.stringify(card));
  });

  it('keeps drafts saved for review, by the review and what its drafts are', async () => {
    const card = {
      kind: 'review',
      reviewId: '0199f3a2-1b2c-7d4e-8f90-a1b2c3d4e5f6',
      drafts: 'email',
    };
    const response = await request({
      chatReply: {
        sessionId: 'session',
        link: false,
        body: {
          kind: 'segments',
          segments: [
            {
              kind: 'activity',
              turn: 2,
              segment: 0,
              sealed: true,
              rows: [
                {
                  id: 'review_0199f3a2-1b2c-7d4e-8f90-a1b2c3d4e5f6',
                  label: 'Prepared drafts to review',
                  status: 'completed',
                  card,
                },
                {
                  id: 't2',
                  label: 'Prepared drafts to review',
                  status: 'completed',
                  card: { ...card, drafts: 'memo' },
                },
              ],
            },
          ],
        },
      },
    });
    expect(response.status).toBe(200);
    const { markdown }: { markdown: string } = await response.json();
    expect(markdown).toContain(JSON.stringify(card));
    expect(markdown).not.toContain('memo');
  });

  it('drops a card it does not know and keeps the step', async () => {
    const response = await request({
      chatReply: {
        sessionId: 'session',
        link: false,
        body: {
          kind: 'segments',
          segments: [
            {
              kind: 'activity',
              turn: 2,
              segment: 0,
              sealed: true,
              rows: [
                {
                  id: 't1',
                  label: 'Ran',
                  status: 'completed',
                  card: { kind: 'hologram', depth: 3 },
                },
                {
                  id: 't2',
                  label: 'Searched',
                  status: 'completed',
                  // What an older server said a search found no longer shows.
                  card: {
                    kind: 'sources',
                    total: 1,
                    sources: [{ kind: 'web', url: 'https://lumen.example' }],
                  },
                },
              ],
            },
          ],
        },
      },
    });
    expect(response.status).toBe(200);
    const { markdown }: { markdown: string } = await response.json();
    expect(markdown).toBe(
      '<m-agent-activity>{"agentSessionId":"session","turn":2,"segment":0,"rows":[{"id":"t1","label":"Ran","status":"completed"},{"id":"t2","label":"Searched","status":"completed"}],"sealed":true}</m-agent-activity>'
    );
  });

  it('rejects a chat reply body it does not know', async () => {
    const response = await request({
      chatReply: { sessionId: 'session', body: { kind: 'spinner' } },
    });
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
