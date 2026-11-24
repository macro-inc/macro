import type { UnifiedNotification } from '@notifications/types';
import type { NotifEvent } from '@service-notification/generated/schemas';
import { describe, expect, it } from 'vitest';
import {
  admitUnread,
  channelStacks,
  keepUnchangedStacks,
  NO_LISTED_NOTIFICATIONS,
  notificationsToMarkDone,
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

const unseen = (record: UnifiedNotification): UnifiedNotification => ({
  ...record,
  state: 'unseen',
});
const ids = (records: readonly UnifiedNotification[]) =>
  records.map((record) => record.id);

// Reads from this moment on count as unread at open.
const OPENED_AT = Date.UTC(2026, 10, 18, 12, 0);
const readAt = (record: UnifiedNotification, at: number) => ({
  ...record,
  viewed_at: new Date(at).toISOString(),
});

describe('admitUnread', () => {
  it('lists nothing until the server answers, then everything unread since opening', () => {
    const notDone = [
      unseen(send('a', 1, 'ana')),
      send('read-long-ago', 2, 'ana'),
      // Read by the Home row that opened the channel.
      readAt(send('read-opening', 3, 'leo'), OPENED_AT + 2_000),
    ];
    const fromCache = admitUnread(
      NO_LISTED_NOTIFICATIONS,
      notDone,
      false,
      OPENED_AT
    );
    const settled = admitUnread(fromCache, notDone, true, OPENED_AT);

    expect(fromCache).toBe(NO_LISTED_NOTIFICATIONS);
    expect(ids(settled.notifications)).toEqual(['a', 'read-opening']);
    expect(settled.closed).toBe(true);
  });

  it('keeps a listed notification once it is read', () => {
    const listed = admitUnread(
      NO_LISTED_NOTIFICATIONS,
      [unseen(send('a', 1, 'ana'))],
      true,
      OPENED_AT
    );

    expect(admitUnread(listed, [], true, OPENED_AT)).toBe(listed);
  });

  it('adds only replies and mentions that arrive after it settles', () => {
    const listed = admitUnread(
      NO_LISTED_NOTIFICATIONS,
      [unseen(send('a', 1, 'ana'))],
      true,
      OPENED_AT
    );
    const later = admitUnread(
      listed,
      [
        unseen(send('a', 1, 'ana')),
        unseen(send('new-message', 5, 'leo')),
        unseen(reply('new-reply', 6, 'leo', 'm-a')),
        // Read as it arrived, on screen.
        readAt(mention('new-mention', 7, 'mara'), OPENED_AT + 60_000),
      ],
      true,
      OPENED_AT
    );

    expect(ids(later.notifications)).toEqual(['a', 'new-reply', 'new-mention']);
  });
});

describe('notificationsToMarkDone', () => {
  it('marks the listed stack with the rest of its inbox stack, and nothing else', () => {
    const listed = channelStacks([unseen(reply('b', 2, 'leo', 'm-root'))]);
    const notDone = channelStacks([
      reply('older', 1, 'ana', 'm-root'),
      unseen(reply('b', 2, 'leo', 'm-root')),
      reply('other-thread', 3, 'mara', 'm-other'),
      send('message', 4, 'mara'),
    ]);

    expect(ids(notificationsToMarkDone(listed, notDone)).sort()).toEqual([
      'b',
      'older',
    ]);
  });

  it('marks the thread a listed root mention is stacked into', () => {
    const listed = channelStacks([unseen(mention('root', 2, 'leo'))]);
    const notDone = channelStacks([
      unseen(mention('root', 2, 'leo')),
      reply('seen-reply', 3, 'ana', 'm-root'),
    ]);

    expect(listed[0]?.key).not.toBe(notDone[0]?.key);
    expect(ids(notificationsToMarkDone(listed, notDone)).sort()).toEqual([
      'root',
      'seen-reply',
    ]);
  });

  it('leaves out what is already done', () => {
    const listed = channelStacks([
      { ...reply('b', 2, 'leo', 'm-root'), state: 'done' },
      unseen(reply('c', 3, 'leo', 'm-root')),
    ]);

    expect(ids(notificationsToMarkDone(listed, []))).toEqual(['c']);
  });
});
