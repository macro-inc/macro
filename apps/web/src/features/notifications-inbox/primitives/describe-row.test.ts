import type { UnifiedNotification } from '@notifications/types';
import { describe, expect, it } from 'vitest';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';
import type { InboxActor } from '../core/inbox-row';
import {
  describeInboxCard,
  describeInboxRow,
  describeStackItem,
  inboxCardKind,
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
  it('gives an email row its sender, subject and snippet', () => {
    const card = describeInboxCard(
      {
        ...stack('email', [
          {
            ...email,
            notification_metadata: {
              tag: 'new_email',
              content: {
                sender: 'Dana',
                subject: 'Quarterly numbers',
                snippet: 'They look good.',
              },
            },
          } as unknown as UnifiedNotification,
        ]),
      },
      { ...people, userName: () => 'Dana' }
    );
    expect(card).toEqual({
      who: 'Dana',
      what: 'Quarterly numbers',
      body: 'They look good.',
    });
  });

  it('gives a message in a channel no middle line', () => {
    const card = describeInboxCard(
      stack('channel_messages', [
        sent('1', 'channel_message_send', 'Sam', {
          ...channel,
          messageContent: 'Ship it',
        }),
      ]),
      people
    );
    expect(card).toEqual({
      who: 'Sam in #launch',
      what: undefined,
      body: 'Ship it',
    });
  });

  it('names what a reply did, and leaves a direct message to the person', () => {
    const reply = describeInboxCard(
      stack('channel_thread', [
        sent('1', 'channel_message_reply', 'Sam', {
          ...channel,
          messageContent: 'On it',
        }),
      ]),
      people
    );
    expect(reply.who).toBe('Sam replied in #launch');

    const direct = describeInboxCard(
      stack('channel_messages', [
        sent('1', 'channel_message_send', 'Dana', {
          channelType: 'directMessage',
          messageContent: 'Hello',
        }),
      ]),
      people
    );
    expect(direct).toMatchObject({ who: 'Dana', body: 'Hello' });
  });

  it('says who invited you, to where, and what they said', () => {
    const card = describeInboxCard(
      stack('channel_messages', [
        sent('1', 'channel_invite', 'Ben', {
          channelName: 'partner-beta',
          isDirectMessage: false,
          messageContent: 'Have a look',
        }),
      ]),
      people
    );
    expect(card).toEqual({
      who: 'Ben invited you',
      what: 'partner-beta',
      body: 'Have a look',
    });
  });

  it('shows a thread stack its top-level message and who said the newest line', () => {
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
    expect(describeInboxCard(row, people)).toEqual({
      who: 'Ana and Leo in #launch',
      what: 'Can we ship Friday?',
      body: 'Ana: On it',
    });
    expect(itemsOf(row).map((item) => item.by)).toEqual([
      'Ana replied',
      'Leo reacted',
    ]);
  });

  it('skips the middle line when no notification carries the root', () => {
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
    expect(card.what).toBeUndefined();
    expect(card.body).toBe('Ana: Newest');
  });

  it('shows a channel stack the channel, who posted and the newest line', () => {
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
    expect(describeInboxCard(row, people)).toEqual({
      who: 'Sam, Noor and 2 others',
      what: '#launch',
      body: 'Sam: Message 0',
    });
    expect(itemsOf(row).map((item) => item.text)).toContain('Message 3');
  });

  it('shows a direct message stack the person and the newest message', () => {
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
    expect(card).toEqual({ who: 'Dana', what: undefined, body: 'Newest' });
  });

  it('shows a document stack the document', () => {
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
    expect(describeInboxCard(row, people)).toEqual({
      who: 'Sam and Ana commented',
      what: 'Launch plan',
      body: 'Sam: Comment 2',
    });
    expect(itemsOf(row).map((item) => item.by)).toEqual([
      'Sam commented',
      'Ana commented',
    ]);
  });

  it('doesn’t repeat a line, such as a mention naming only its document', () => {
    const card = describeInboxCard(
      stack('discussion_mention', [
        sent('1', 'document_mention', 'Sam', { documentName: 'Launch plan' }),
      ]),
      people
    );
    expect(card.what).toBe('Launch plan');
    expect(card.body).toBeUndefined();
  });

  it('shows an agent stack its session and newest update', () => {
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
    expect(describeInboxCard(row, people)).toEqual({
      who: 'Macro finished',
      what: 'Build the tracker',
      body: 'Update 2',
    });
    expect(itemsOf(row).map((item) => item.text)).toEqual([
      'Update 2',
      'Update 1',
    ]);
  });

  it('never leaves the first line empty', () => {
    const card = describeInboxCard(
      {
        ...row({ kind: 'other' }),
        content: { ...row(undefined).content, notifications: [] },
      },
      names
    );
    expect(card).toEqual({ who: 'Task' });
  });
});

describe('inboxCardKind', () => {
  const kindOf = (
    type: NotificationInboxRow['type'],
    tag: string,
    content: Record<string, unknown> = {}
  ) => inboxCardKind(stack(type, [sent('1', tag, 'Sam', content)]));

  it('tells a channel from a direct message, an invite and a reaction', () => {
    expect(kindOf('channel_messages', 'channel_message_send', channel)).toBe(
      'channel'
    );
    expect(
      kindOf('channel_messages', 'channel_message_send', {
        channelType: 'directMessage',
      })
    ).toBe('message');
    expect(kindOf('channel_messages', 'channel_invite')).toBe('invite');
    expect(kindOf('channel_thread', 'channel_message_reaction')).toBe(
      'reaction'
    );
  });

  it('keeps a mention a mention whatever arrived after it', () => {
    expect(kindOf('channel_mention', 'channel_message_reply', channel)).toBe(
      'mention'
    );
  });

  it('tells a comment from a reply on a document', () => {
    expect(kindOf('discussion_messages', 'commented_on_document')).toBe(
      'comment'
    );
    expect(
      kindOf('discussion_thread', 'replied_to_document_comment_thread')
    ).toBe('reply');
  });

  it('tells a reminder from an email, though they share a row', () => {
    expect(kindOf('email', 'new_email')).toBe('email');
    expect(kindOf('email', 'reminder')).toBe('reminder');
  });

  it('keeps a kind this build doesn’t know generic', () => {
    expect(kindOf('other', 'something_new')).toBe('other');
  });
});
