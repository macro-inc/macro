import type { UnifiedNotification } from '@notifications/types';
import type { NotifEvent } from '@service-notification/generated/schemas';
import { describe, expect, it } from 'vitest';
import {
  channelStacks,
  keepUnchangedStacks,
  stacksByThread,
} from './channel-stacks';

function notification(
  id: string,
  minute: number,
  sender: string,
  metadata: NotifEvent
): UnifiedNotification {
  const at = new Date(Date.UTC(2026, 10, 18, 10, minute)).toISOString();
  return {
    id,
    entity_id: 'channel-1',
    entity_type: 'channel',
    created_at: at,
    updated_at: at,
    viewed_at: null,
    deleted_at: null,
    state: 'seen',
    sent: true,
    sender_id: sender,
    notification_event_type: metadata.tag,
    notification_metadata: metadata,
  };
}

const send = (id: string, minute: number, sender: string) =>
  notification(id, minute, sender, {
    tag: 'channel_message_send',
    content: {
      messageId: `m-${id}`,
      messageContent: '',
      channelType: 'public',
    },
  });

const reply = (id: string, minute: number, sender: string, threadId: string) =>
  notification(id, minute, sender, {
    tag: 'channel_message_reply',
    content: {
      messageId: `m-${id}`,
      threadId,
      messageContent: '',
      userId: sender,
      channelType: 'public',
    },
  });

const mention = (
  id: string,
  minute: number,
  sender: string,
  threadId: string | null = null
) =>
  notification(id, minute, sender, {
    tag: 'channel_mention',
    content: {
      messageId: `m-${id}`,
      messageContent: '',
      threadId,
      channelType: 'public',
    },
  });

describe('channelStacks', () => {
  it('stacks new messages, each thread and each top-level mention, oldest first', () => {
    const stacks = channelStacks([
      send('rahul-2', 46, 'rahul'),
      send('maya', 44, 'maya'),
      send('rahul-1', 41, 'rahul'),
      mention('jonah', 34, 'jonah'),
      reply('teo', 31, 'teo', 'm-root'),
    ]);

    expect(
      stacks.map((stack) => ({
        key: stack.key,
        kind: stack.kind,
        senders: stack.senderIds,
        anchor: stack.anchor,
      }))
    ).toEqual([
      {
        key: 'thread:m-root',
        kind: 'thread',
        senders: ['teo'],
        anchor: { messageId: 'm-teo', threadId: 'm-root' },
      },
      {
        key: 'mention:m-jonah',
        kind: 'mention',
        senders: ['jonah'],
        anchor: { messageId: 'm-jonah' },
      },
      {
        key: 'messages',
        kind: 'messages',
        senders: ['rahul', 'maya'],
        anchor: { messageId: 'm-rahul-2' },
      },
    ]);
  });

  it('anchors a thread at its newest reply and notes a mention inside it', () => {
    const [thread] = channelStacks([
      reply('a', 10, 'teo', 'm-root'),
      mention('b', 12, 'ana', 'm-root'),
      reply('c', 11, 'teo', 'm-root'),
    ]);

    expect(thread.kind).toBe('thread');
    expect(thread.anchor).toEqual({ messageId: 'm-b', threadId: 'm-root' });
    expect(thread.senderIds).toEqual(['ana', 'teo']);
    expect(thread.mentionsViewer).toBe(true);
  });

  it('leaves reactions out', () => {
    const stacks = channelStacks([
      notification('r', 5, 'teo', {
        tag: 'channel_message_reaction',
        content: {
          messageId: 'm-1',
          emoji: '👍',
          channelType: 'public',
        },
      } as NotifEvent),
    ]);

    expect(stacks).toEqual([]);
  });
});

describe('stacksByThread', () => {
  it('puts top-level checks on their message and reply checks under their thread', () => {
    const index = stacksByThread(
      channelStacks([
        reply('teo', 31, 'teo', 'm-root'),
        mention('jonah', 34, 'jonah'),
      ])
    );

    expect(index.get('m-root')?.root).toEqual([]);
    expect(index.get('m-root')?.replies.get('m-teo')?.[0]?.kind).toBe('thread');
    expect(index.get('m-jonah')?.root.map((stack) => stack.kind)).toEqual([
      'mention',
    ]);
  });
});

describe('keepUnchangedStacks', () => {
  it('keeps an unchanged stack and replaces a changed one', () => {
    const before = channelStacks([
      send('a', 1, 'ana'),
      reply('b', 2, 'leo', 'root-1'),
    ]);
    const after = keepUnchangedStacks(
      before,
      channelStacks([
        send('a', 1, 'ana'),
        send('c', 3, 'mara'),
        reply('b', 2, 'leo', 'root-1'),
      ])
    );

    const thread = (stacks: typeof before) =>
      stacks.find((stack) => stack.kind === 'thread');
    const messages = (stacks: typeof before) =>
      stacks.find((stack) => stack.kind === 'messages');
    expect(thread(after)).toBe(thread(before));
    expect(messages(after)).not.toBe(messages(before));
    expect(messages(after)?.notifications).toHaveLength(2);
  });
});
