import type { UnifiedNotification } from '@notifications/types';
import { describe, expect, it } from 'vitest';
import {
  unreadNotificationChip,
  unreadThreads,
} from '../unread-thread-navigation';

function reply(id: string, threadId: string, hour = 12): UnifiedNotification {
  return {
    id,
    entity_id: 'channel',
    entity_type: 'channel',
    state: 'unseen',
    sent: true,
    created_at: `2026-09-01T${hour}:00:00Z`,
    updated_at: '2026-09-01T00:00:00Z',
    viewed_at: null,
    notification_event_type: 'channel_message_reply',
    notification_metadata: {
      tag: 'channel_message_reply',
      content: {
        messageId: id,
        threadId,
        channelType: 'private',
        messageContent: 'Hello',
      },
    },
  };
}
const positions = new Map([
  ['old', { id: 'old', created_at: '2026-08-01T00:00:00Z' }],
  ['middle', { id: 'middle', created_at: '2026-08-02T00:00:00Z' }],
  ['new', { id: 'new', created_at: '2026-08-03T00:00:00Z' }],
]);
const visible = { first: 'middle', last: 'middle' };

describe('channel unread notification navigation', () => {
  it('counts three replies and a mention of one reply as one thread', () => {
    const mention = reply('third', 'old', 14);
    mention.notification_metadata = {
      tag: 'channel_mention',
      content: {
        messageId: 'third',
        threadId: 'old',
        channelType: 'private',
        messageContent: '@you',
      },
    };
    expect(
      unreadThreads([
        reply('first', 'old'),
        reply('second', 'old', 13),
        reply('third', 'old', 14),
        mention,
      ])
    ).toEqual([
      {
        threadId: 'old',
        messageId: 'third',
        createdAt: '2026-09-01T14:00:00Z',
      },
    ]);
  });

  it('compares actual instants even when timestamps differ in precision', () => {
    const early = {
      ...reply('early', 'old'),
      created_at: '2026-09-01T12:00:00Z',
    };
    const later = {
      ...reply('later', 'old'),
      created_at: '2026-09-01T12:00:00.500Z',
    };
    expect(unreadThreads([early, later])[0].messageId).toBe('later');
    expect(
      unreadThreads([
        early,
        {
          ...later,
          notification_metadata: reply('later', 'new').notification_metadata,
        },
      ])[0].threadId
    ).toBe('new');
  });

  it('excludes seen, done, reactions, and non-channel records', () => {
    const reaction = reply('reaction', 'new');
    reaction.notification_metadata = {
      tag: 'channel_message_reaction',
      content: {
        messageId: 'reaction',
        threadId: 'new',
        channelType: 'private',
        emoji: '👍',
        messageContent: 'Hello',
      },
    };
    expect(
      unreadThreads([
        { ...reply('seen', 'old'), state: 'seen' },
        { ...reply('done', 'old'), state: 'done' },
        { ...reply('document', 'old'), entity_type: 'document' },
        reaction,
      ])
    ).toEqual([]);
  });

  it('counts separate top-level messages separately and merges their thread notifications', () => {
    const root = (id: string): UnifiedNotification => ({
      ...reply(id, id),
      notification_metadata: {
        tag: 'channel_message_send',
        content: { messageId: id, channelType: 'private' },
      },
    });
    expect(
      unreadThreads([root('old'), root('new'), reply('reply', 'old', 13)])
    ).toHaveLength(2);
  });

  it('shows one chip for the most recent notification, with the total thread count', () => {
    const threads = unreadThreads([
      reply('a', 'new', 12),
      reply('b', 'old', 13),
    ]);
    expect(unreadNotificationChip(threads, positions, visible)).toMatchObject({
      count: 2,
      direction: 'above',
      thread: { messageId: 'b' },
    });
    // A live delivery changes the target and direction, but never double-counts its thread.
    const live = unreadThreads([
      reply('a', 'new', 12),
      reply('b', 'old', 13),
      reply('c', 'new', 14),
    ]);
    expect(unreadNotificationChip(live, positions, visible)).toMatchObject({
      count: 2,
      direction: 'below',
      thread: { messageId: 'c' },
    });
  });

  it('uses measured reply position within a tall thread and hides for a visible message', () => {
    const threads = unreadThreads([reply('a', 'middle')]);
    expect(
      unreadNotificationChip(threads, positions, visible, 'above')?.direction
    ).toBe('above');
    expect(
      unreadNotificationChip(threads, positions, visible, 'below')?.direction
    ).toBe('below');
    expect(
      unreadNotificationChip(threads, positions, visible, 'visible')
    ).toBeUndefined();
    expect(unreadNotificationChip(threads, positions, visible)?.direction).toBe(
      'below'
    );
  });

  it('waits for layout and an unloaded parent position instead of guessing from reply time', () => {
    const threads = unreadThreads([reply('a', 'old')]);
    expect(
      unreadNotificationChip(threads, positions, undefined)
    ).toBeUndefined();
    expect(unreadNotificationChip(threads, new Map(), visible)).toBeUndefined();
  });
});
