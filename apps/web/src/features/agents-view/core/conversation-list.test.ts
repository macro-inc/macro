import { describe, expect, it } from 'vitest';
import type { ConversationFacts } from './conversation-filters';
import {
  partitionWaitingConversations,
  sortConversations,
  sortConversationTimestamp,
} from './conversation-list';

describe('conversation list', () => {
  it('uses last update with created fallback, and created date on demand', () => {
    const rows = [
      { id: 'old-updated', createdAt: '2026-03-03', updatedAt: '2026-03-04' },
      { id: 'new-created', createdAt: '2026-03-05', updatedAt: '2026-03-01' },
      { id: 'fallback', createdAt: '2026-03-02', updatedAt: null },
      { id: 'unknown', createdAt: 'bad', updatedAt: null },
    ];
    expect(sortConversations(rows, 'updated').map((row) => row.id)).toEqual([
      'old-updated',
      'fallback',
      'new-created',
      'unknown',
    ]);
    expect(sortConversations(rows, 'created').map((row) => row.id)).toEqual([
      'new-created',
      'old-updated',
      'fallback',
      'unknown',
    ]);
    expect(rows.map((row) => row.id)).toEqual([
      'old-updated',
      'new-created',
      'fallback',
      'unknown',
    ]);
    expect(
      sortConversationTimestamp(
        { updatedAt: '2026-03-06', createdAt: 'bad' },
        'created'
      )
    ).toBe(0);
  });

  it('partitions only blocked conversations and preserves each order', () => {
    const rows = ['waiting-1', 'working', 'waiting-2', 'unread'];
    const factsOf = (id: string): ConversationFacts => ({
      mode: 'code',
      state: id.startsWith('waiting')
        ? 'waiting'
        : id === 'working'
          ? 'working'
          : 'dormant',
      unread: id === 'unread',
      pullRequest: null,
    });
    expect(partitionWaitingConversations(rows, factsOf)).toEqual({
      waiting: ['waiting-1', 'waiting-2'],
      conversations: ['working', 'unread'],
    });
  });
});
