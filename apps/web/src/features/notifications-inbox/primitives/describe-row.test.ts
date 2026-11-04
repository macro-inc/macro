import type { UnifiedNotification } from '@notifications/types';
import { describe, expect, it } from 'vitest';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';
import type { InboxActor } from '../core/inbox-row';
import {
  describeInboxCard,
  describeInboxRow,
  describeStackItem,
} from './describe-row';

const taskAssigned = {
  id: 'n-1',
  entity_type: 'task',
  entity_id: 'task-a',
  sender_id: 'macro|ana@example.com',
  notification_metadata: {
    tag: 'task_assigned',
    content: { taskName: 'Ship the inbox' },
  },
} as unknown as UnifiedNotification;

const email = {
  id: 'n-2',
  entity_type: 'email_thread',
  entity_id: 'thread-a',
  sender_id: null,
  notification_metadata: {
    tag: 'new_email',
    content: { sender: 'Dana', subject: 'Quarterly numbers' },
  },
} as unknown as UnifiedNotification;

const row = (
  actor: InboxActor | undefined,
  notification: UnifiedNotification = taskAssigned
): NotificationInboxRow => ({
  id: 'row',
  type: 'task',
  revision: 'rev',
  latestAt: 1,
  actor,
  actions: [],
  unseen: true,
  count: 1,
  content: {
    entity: { type: 'task', id: 'task-a', name: 'Task' } as never,
    notifications: [notification],
    entityAt: () => ({}) as never,
  },
});

type Names = Parameters<typeof describeInboxRow>[1];

const names: Names = {
  userName: (id) => (id === 'macro|ana@example.com' ? 'Ana' : 'Bo'),
  senderName: () => undefined,
};

const action = (
  actor: InboxActor | undefined,
  senderName: Names['senderName'] = names.senderName
) => describeInboxRow(row(actor), { ...names, senderName }).action;

describe('describeInboxRow', () => {
  it('names the row’s author from its actor', () => {
    expect(action({ kind: 'user', id: 'macro|ana@example.com' })).toBe(
      'Ana assigned you a task'
    );
    expect(action({ kind: 'agent', name: 'Builder' })).toBe(
      'Builder assigned you a task'
    );
    expect(action({ kind: 'macro' })).toBe('Macro assigned you a task');
  });

  it('keeps the sender a notification names itself, such as a GitHub login', () => {
    expect(
      action({ kind: 'user', id: 'macro|ana@example.com' }, () => 'octocat')
    ).toBe('octocat assigned you a task');
  });

  it('names no author for an actor kind this build doesn’t know', () => {
    expect(action({ kind: 'other' })).toBe('assigned you a task');
  });

  it('names an outside sender from the notification', () => {
    expect(describeInboxRow(row(undefined, email), names)).toEqual({
      action: 'Dana sent you an email',
      subject: 'Quarterly numbers',
    });
  });
});

const sent = (
  id: string,
  tag: string,
  sender: string,
  content: Record<string, unknown>
) =>
  ({
    id,
    entity_type: 'channel',
    entity_id: 'channel-a',
    sender_id: sender,
    created_at: '2026-03-01T10:00:00Z',
    notification_metadata: { tag, content },
  }) as unknown as UnifiedNotification;

const stack = (
  type: NotificationInboxRow['type'],
  notifications: UnifiedNotification[],
  threadId?: string
): NotificationInboxRow => ({
  id: 'stack',
  type,
  threadId,
  revision: 'rev',
  latestAt: 1,
  actions: [],
  unseen: true,
  count: notifications.length,
  content: {
    entity: { type: 'channel', id: 'entity', name: 'The entity' } as never,
    notifications,
    entityAt: () => ({}) as never,
  },
});

const people: Names = {
  userName: (id) => id,
  senderName: () => undefined,
};

const channel = { channelType: 'public', channelName: 'launch' };

const itemsOf = (row: NotificationInboxRow) =>
  row.content.notifications.map((notification) =>
    describeStackItem(row, notification, people)
  );

describe('describeInboxCard', () => {
  it('says what a single notification is about and who did it', () => {
    const card = describeInboxCard(
      stack('channel_messages', [
        sent('1', 'channel_message_send', 'Sam', {
          ...channel,
          messageContent: 'Ship it',
        }),
      ]),
      people
    );
    expect(card).toMatchObject({
      title: 'Ship it',
      detail: 'Sam sent a message in #launch',
    });
  });

  it('titles a thread stack with its top-level message', () => {
    const row = stack(
      'channel_thread',
      [
        sent('3', 'channel_message_reply', 'Ana', {
          ...channel,
          messageId: 'reply',
          threadId: 'root',
          messageContent: 'On it',
        }),
        sent('2', 'channel_message_reaction', 'Leo', {
          ...channel,
          messageId: 'root',
          messageContent: 'Can we ship Friday?',
          emoji: '+1',
        }),
      ],
      'root'
    );
    const card = describeInboxCard(row, people);
    expect(card.title).toBe('Can we ship Friday?');
    expect(card.detail).toBe('Ana and Leo in #launch');
    expect(itemsOf(row).map((item) => item.by)).toEqual([
      'Ana replied',
      'Leo reacted',
    ]);
  });

  it('falls back to the newest message when no notification carries the root', () => {
    const card = describeInboxCard(
      stack(
        'channel_thread',
        [
          sent('2', 'channel_message_reply', 'Ana', {
            ...channel,
            messageId: 'b',
            threadId: 'root',
            messageContent: 'Newest',
          }),
          sent('1', 'channel_message_reply', 'Sam', {
            ...channel,
            messageId: 'a',
            threadId: 'root',
            messageContent: 'Older',
          }),
        ],
        'root'
      ),
      people
    );
    expect(card.title).toBe('Newest');
  });

  it('titles a channel stack with the channel and names who posted', () => {
    const row = stack(
      'channel_messages',
      ['Sam', 'Noor', 'Sam', 'Mara', 'Leo'].map((sender, index) =>
        sent(String(index), 'channel_message_send', sender, {
          ...channel,
          messageId: `m-${index}`,
          messageContent: `Message ${index}`,
        })
      )
    );
    const card = describeInboxCard(row, people);
    expect(card.title).toBe('#launch');
    expect(card.detail).toBe('Sam, Noor and 2 others posted');
    expect(itemsOf(row).map((item) => item.text)).toContain('Message 3');
  });

  it('titles a direct message stack with the person and shows the newest message', () => {
    const card = describeInboxCard(
      stack('channel_messages', [
        sent('2', 'channel_message_send', 'Dana', {
          channelType: 'directMessage',
          messageContent: 'Newest',
        }),
        sent('1', 'channel_message_send', 'Dana', {
          channelType: 'directMessage',
          messageContent: 'Older',
        }),
      ]),
      people
    );
    expect(card).toMatchObject({ title: 'Dana', detail: 'Newest' });
  });

  it('titles a document stack with the document', () => {
    const comment = (id: string, sender: string) =>
      sent(id, 'commented_on_document', sender, {
        documentName: 'Launch plan',
        commentId: id,
        threadId: id,
        text: `Comment ${id}`,
      });
    const row = stack('discussion_messages', [
      comment('2', 'Sam'),
      comment('1', 'Ana'),
    ]);
    const card = describeInboxCard(row, people);
    expect(card.title).toBe('Launch plan');
    expect(card.detail).toBe('Sam and Ana commented');
    expect(itemsOf(row).map((item) => item.by)).toEqual([
      'Sam commented',
      'Ana commented',
    ]);
  });

  it('titles an agent stack with its session', () => {
    const settled = (id: string) =>
      ({
        id,
        entity_type: 'agent_session',
        entity_id: 'session',
        sender_id: null,
        created_at: '2026-03-01T10:00:00Z',
        notification_metadata: {
          tag: 'agent_session_settled',
          content: {
            sessionName: 'Build the tracker',
            botName: 'Macro',
            excerpt: `Update ${id}`,
          },
        },
      }) as unknown as UnifiedNotification;
    const row: NotificationInboxRow = {
      ...stack('agent', [settled('2'), settled('1')]),
      actor: { kind: 'agent', name: 'Macro' },
    };
    const card = describeInboxCard(row, people);
    expect(card.title).toBe('Build the tracker');
    expect(card.detail).toBe('Macro finished');
    expect(itemsOf(row).map((item) => item.text)).toEqual([
      'Update 2',
      'Update 1',
    ]);
  });
});
