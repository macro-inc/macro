import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import { describe, expect, it } from 'vitest';
import { buildPostMessageRequest } from '../message-payload';

const snap = (mentions: ItemMention[]) => ({
  value: '',
  mentions,
  attachments: [],
});

describe('authored group references', () => {
  it('preserves display-only mention chips in the body without blocking a send', () => {
    const snapshot = {
      ...snap([
        { itemType: 'date', itemId: '2026-09-09' },
        { itemType: 'contact', itemId: 'contact-1' },
        {
          itemType: 'foreign',
          itemId: 'https://github.com/example/repo/pull/1',
        },
        { itemType: 'skill', itemId: 'builtin:review' },
        { itemType: 'document', itemId: 'doc-1' },
        { itemType: 'user', itemId: 'macro|a@example.com' },
      ]),
      value:
        'Review the PR with this contact on <m-date-mention>{"date":"2026-09-09"}</m-date-mention>.',
    };
    const result = buildPostMessageRequest({ snapshot });
    expect(result.content).toBe(snapshot.value);
    expect(result.mentions).toEqual([
      { entity_type: 'document', entity_id: 'doc-1' },
      { entity_type: 'user', entity_id: 'macro|a@example.com' },
    ]);
  });

  it('retains @here and explicit users without depending on a cached participant roster', () => {
    const result = buildPostMessageRequest({
      snapshot: snap([
        { itemType: 'user', itemId: 'macro|a@example.com' },
        { itemType: 'group', itemId: 'here', groupAlias: 'here' },
        { itemType: 'group', itemId: 'here', groupAlias: 'here' },
      ]),
    });
    expect(result.mentions).toEqual([
      { entity_type: 'user', entity_id: 'macro|a@example.com' },
      { entity_type: 'group', entity_id: 'here' },
    ]);
  });
  it('normalizes email, call, and calendar references with the same vocabulary as Markdown extraction', () => {
    const result = buildPostMessageRequest({
      snapshot: snap([
        { itemType: 'thread', itemId: 'email-1' },
        { itemType: 'call', itemId: 'call-1' },
        { itemType: 'calendar_event', itemId: 'event-1' },
      ]),
    });
    expect(result.mentions?.map((mention) => mention.entity_type)).toEqual([
      'thread',
      'call',
      'calendar_event',
    ]);
  });
});

describe('buildPostMessageRequest — bot mentions', () => {
  const MACRO_AI_PRINCIPAL = 'bot|00000000-0000-0000-0000-00000000a1a1';
  const BOT_PRINCIPAL = 'bot|11111111-1111-1111-1111-111111111111';

  it('re-tags bot-principal user mentions as bot mentions', () => {
    const result = buildPostMessageRequest({
      snapshot: snap([
        { itemType: 'user', itemId: BOT_PRINCIPAL },
        { itemType: 'user', itemId: 'macro|human@example.com' },
        { itemType: 'user', itemId: MACRO_AI_PRINCIPAL },
      ]),
    });

    expect(result.mentions).toEqual([
      { entity_type: 'bot', entity_id: BOT_PRINCIPAL },
      { entity_type: 'user', entity_id: 'macro|human@example.com' },
      { entity_type: 'bot', entity_id: MACRO_AI_PRINCIPAL },
    ]);
  });

  it('deduplicates repeated bot mentions', () => {
    const result = buildPostMessageRequest({
      snapshot: snap([
        { itemType: 'user', itemId: BOT_PRINCIPAL },
        { itemType: 'user', itemId: BOT_PRINCIPAL },
      ]),
    });

    expect(result.mentions).toEqual([
      { entity_type: 'bot', entity_id: BOT_PRINCIPAL },
    ]);
  });

  it('does not fan bots out through @here', () => {
    const result = buildPostMessageRequest({
      snapshot: snap([
        { itemType: 'group', itemId: 'here', groupAlias: 'here' },
      ]),
      // Recipient expansion happens on the server; no bot principal is authored.
    });

    expect(result.mentions).toEqual([
      { entity_type: 'group', entity_id: 'here' },
    ]);
  });
});
