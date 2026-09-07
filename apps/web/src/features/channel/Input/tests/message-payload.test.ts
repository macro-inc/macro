import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import { describe, expect, it } from 'vitest';
import { buildPostMessageRequest } from '../message-payload';

const snap = (mentions: ItemMention[]) => ({
  value: '',
  mentions,
  attachments: [],
});

describe('authored group references', () => {
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
