import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import { describe, expect, it } from 'vitest';
import { buildPostMessageRequest } from '../message-payload';

const snap = (mentions: ItemMention[]) => ({
  value: '',
  mentions,
  attachments: [],
});

describe('buildPostMessageRequest — @here expansion', () => {
  it('deduplicates @here expansion against an earlier explicit user mention', () => {
    const result = buildPostMessageRequest({
      snapshot: snap([
        { itemType: 'user', itemId: 'user-a' },
        { itemType: 'group', itemId: 'here', groupAlias: 'here' },
      ]),
      participantIds: ['user-a', 'user-b'],
    });

    // user-a should appear once (from the explicit mention), user-b from @here
    expect(result.mentions).toEqual([
      { entity_type: 'user', entity_id: 'user-a' },
      { entity_type: 'user', entity_id: 'user-b' },
    ]);
  });

  it('preserves non-user mentions when mixed with @here', () => {
    const result = buildPostMessageRequest({
      snapshot: snap([
        { itemType: 'document', itemId: 'doc-1' },
        { itemType: 'group', itemId: 'here', groupAlias: 'here' },
        { itemType: 'document', itemId: 'doc-1' },
      ]),
      participantIds: ['user-a'],
    });

    // Documents are not deduped (no user-id semantics), @here expands to user-a
    expect(result.mentions).toEqual([
      { entity_type: 'document', entity_id: 'doc-1' },
      { entity_type: 'user', entity_id: 'user-a' },
      { entity_type: 'document', entity_id: 'doc-1' },
    ]);
  });

  it('deduplicates explicit user mention against earlier @here expansion', () => {
    const result = buildPostMessageRequest({
      snapshot: snap([
        { itemType: 'group', itemId: 'here', groupAlias: 'here' },
        { itemType: 'user', itemId: 'user-a' },
      ]),
      participantIds: ['user-a', 'user-b'],
    });

    // user-a and user-b from @here; trailing explicit user-a skipped
    expect(result.mentions).toEqual([
      { entity_type: 'user', entity_id: 'user-a' },
      { entity_type: 'user', entity_id: 'user-b' },
    ]);
  });

  it('produces no user mentions when @here is used with empty participants', () => {
    const result = buildPostMessageRequest({
      snapshot: snap([
        { itemType: 'group', itemId: 'here', groupAlias: 'here' },
      ]),
    });

    expect(result.mentions).toEqual([]);
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
      participantIds: ['macro|human@example.com'],
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
      // @here expands participant user ids only; bots are never participants.
      participantIds: ['macro|human@example.com'],
    });

    expect(result.mentions).toEqual([
      { entity_type: 'user', entity_id: 'macro|human@example.com' },
    ]);
  });
});
