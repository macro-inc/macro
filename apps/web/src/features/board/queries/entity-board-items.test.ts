import type {
  ChannelEntity,
  ChannelThreadEntity,
  EmailEntity,
  EntityData,
  WithNotification,
} from '@entity';
import type { UnifiedNotification } from '@notifications/types';
import type { NotifEvent } from '@service-notification/generated/schemas';
import { describe, expect, it } from 'vitest';
import { type BoardItemResolvers, toBoardItem } from './entity-board-items';

const NOW = Date.UTC(2026, 9, 28, 17, 0);
const VIEWER = 'macro|jordan@example.com';
const ANA = 'macro|ana@example.com';

const resolvers: BoardItemResolvers = {
  viewerId: VIEWER,
  userName: (id) =>
    ({ [VIEWER]: 'Jordan Lee', [ANA]: 'Ana Ruiz' })[id] ?? 'Someone',
  botName: () => undefined,
  channelName: (id, fallback) => (id === 'c-launch' ? 'launch' : fallback),
  updatedText: 'Updated',
  threadContext: (channel) => `Thread in #${channel}`,
  agentStatus: (state) => (state === 'dormant' ? undefined : state),
  pullRequestStatus: (state) => state,
};

function notification(
  id: string,
  minutesAgo: number,
  metadata: NotifEvent,
  state: UnifiedNotification['state'] = 'unseen'
): UnifiedNotification {
  const at = new Date(NOW - minutesAgo * 60_000).toISOString();
  return {
    id,
    entity_id: 'c-launch',
    entity_type: 'channel',
    created_at: at,
    updated_at: at,
    viewed_at: null,
    deleted_at: null,
    state,
    sent: true,
    sender_id: ANA,
    notification_event_type: metadata.tag,
    notification_metadata: metadata,
  };
}

function withNotifications<T extends EntityData>(
  entity: T,
  notifications: UnifiedNotification[]
): WithNotification<T> {
  return { ...entity, notifications: () => notifications };
}

const launch: ChannelEntity = {
  id: 'c-launch',
  type: 'channel',
  name: 'launch-old-name',
  ownerId: VIEWER,
  channelType: 'public',
  updatedAt: new Date(NOW - 30 * 60_000).toISOString(),
  latestMessage: {
    messageId: 'm-mine',
    content: 'Thanks! I’ll review before 4',
    senderId: VIEWER,
    createdAt: new Date(NOW - 2 * 60_000).toISOString(),
    mentions: [],
  },
};

describe('toBoardItem', () => {
  it('turns a channel’s notifications and latest message into a conversation', () => {
    const item = toBoardItem(
      withNotifications(launch, [
        notification('n1', 20, {
          tag: 'channel_mention',
          content: {
            channelType: 'public',
            messageId: 'm1',
            messageContent: '@Jordan need eyes on pricing',
          },
        }),
      ]),
      resolvers
    );

    expect(item).toMatchObject({
      key: 'channel:c-launch',
      zone: 'channels',
      kind: 'channel',
      title: 'launch',
      groupKey: 'c-launch',
      unreadCount: 1,
      needsYou: true,
      lastActivityAt: NOW - 2 * 60_000,
    });
    expect(
      item?.messages.map((message) => [
        message.author?.name,
        message.author?.isSelf,
        message.text,
        message.unread,
      ])
    ).toEqual([
      ['Ana Ruiz', false, '@Jordan need eyes on pricing', true],
      ['Jordan Lee', true, 'Thanks! I’ll review before 4', false],
    ]);
  });

  it('settles read notifications and drops done ones', () => {
    const item = toBoardItem(
      withNotifications(launch, [
        notification(
          'n1',
          20,
          {
            tag: 'channel_message_send',
            content: {
              channelType: 'public',
              messageId: 'm1',
              messageContent: 'seen already',
            },
          },
          'seen'
        ),
        notification(
          'n2',
          10,
          {
            tag: 'channel_message_send',
            content: {
              channelType: 'public',
              messageId: 'm2',
              messageContent: 'cleared',
            },
          },
          'done'
        ),
      ]),
      resolvers
    );

    expect(item?.unreadCount).toBe(0);
    expect(item?.needsYou).toBe(false);
    expect(item?.messages.map((message) => message.text)).toEqual([
      'seen already',
      'Thanks! I’ll review before 4',
    ]);
  });

  it('faces a direct message with the other person and counts it as needing you', () => {
    const item = toBoardItem(
      withNotifications(
        {
          ...launch,
          id: 'dm-ana',
          channelType: 'direct_message',
          participantIds: [VIEWER, ANA],
        },
        [
          notification('n1', 5, {
            tag: 'channel_message_send',
            content: {
              channelType: 'directMessage',
              messageId: 'm1',
              messageContent: 'Can you look at the offer letter?',
            },
          }),
        ]
      ),
      resolvers
    );

    expect(item).toMatchObject({
      zone: 'dms',
      kind: 'dm',
      needsYou: true,
      face: { id: ANA, name: 'Ana Ruiz', isSelf: false },
    });
  });

  it('keeps a thread beside its channel and quotes its replies', () => {
    const thread: ChannelThreadEntity = {
      id: 't1',
      type: 'channel_thread',
      name: 'launch',
      ownerId: VIEWER,
      channelId: 'c-launch',
      channelType: 'public',
      messageId: 'root',
      threadId: 'root',
      senderId: ANA,
      sender: { id: 'ana', type: 'user' },
      content: 'Pricing copy v2 — thoughts?',
      attachments: [],
      reactions: [],
      createdAt: new Date(NOW - 50 * 60_000).toISOString(),
      thread: {
        replyCount: 1,
        preview: [
          {
            id: 'r1',
            content: 'Lead with the free tier',
            created_at: new Date(NOW - 14 * 60_000).toISOString(),
            updated_at: new Date(NOW - 14 * 60_000).toISOString(),
            sender_id: VIEWER,
            sender: { id: 'jordan', type: 'user' },
            attachments: [],
            reactions: [],
          },
        ],
      },
    };
    const item = toBoardItem(withNotifications(thread, []), resolvers);

    expect(item).toMatchObject({
      key: 'channel_thread:t1',
      kind: 'thread',
      title: 'Pricing copy v2 — thoughts?',
      context: 'Thread in #launch',
      groupKey: 'c-launch',
    });
    expect(item?.messages.map((message) => message.text)).toEqual([
      'Pricing copy v2 — thoughts?',
      'Lead with the free tier',
    ]);
  });

  it('shows an unread email from its sender', () => {
    const email: EmailEntity = {
      id: 'e1',
      type: 'email',
      name: 'Office visit next week',
      ownerId: VIEWER,
      isRead: false,
      isDraft: false,
      isImportant: true,
      done: false,
      snippet: 'Is 2pm still good?',
      senderEmail: 'priya@northwind.example',
      senderName: 'Priya Shah',
      updatedAt: new Date(NOW - 18 * 60_000).toISOString(),
    };
    const item = toBoardItem(withNotifications(email, []), resolvers);

    expect(item).toMatchObject({
      zone: 'email',
      title: 'Office visit next week',
      context: 'Priya Shah',
      unreadCount: 1,
      face: { kind: 'contact', name: 'Priya Shah' },
    });
    expect(item?.messages[0]).toMatchObject({
      text: 'Is 2pm still good?',
      unread: true,
    });
  });

  it('names what an agent run is doing, and says nothing while it rests', () => {
    const run = (turnState: string) =>
      toBoardItem(
        withNotifications(
          {
            id: 'run-1',
            type: 'agent_session',
            name: 'Fix flaky checkout test',
            ownerId: VIEWER,
            botId: 'bot-1',
            status: 'ready',
            turnState,
          },
          []
        ),
        resolvers
      );

    expect(run('blocked')).toMatchObject({ zone: 'agents', status: 'waiting' });
    expect(run('running')?.status).toBe('working');
    expect(run('idle')?.status).toBeUndefined();
  });

  it('leaves out kinds the board does not draw', () => {
    expect(
      toBoardItem(
        withNotifications(
          {
            id: 'x',
            type: 'routine',
            name: 'Nightly digest',
            ownerId: VIEWER,
            status: { kind: 'unscheduled' },
          },
          []
        ),
        resolvers
      )
    ).toBeUndefined();
  });
});
