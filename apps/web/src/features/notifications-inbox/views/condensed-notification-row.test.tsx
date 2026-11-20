import { HomeListEntity } from '@app/features/home/components/HomeListEntity';
import type { EntityData, WithNotification } from '@entity';
import type { UnifiedNotification } from '@notifications/types';
import { cleanup, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';
import type { InboxRowType } from '../core/inbox-row';
import { CondensedNotificationRow } from './condensed-notification-row';

vi.mock('@app/features/agents-view/views/AgentSessionListItem', () => ({
  AgentSessionListItem: () => null,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
vi.mock('@core/user', () => ({
  getDisplayName: (id: string) => (id === 'macro|ana' ? 'Ana' : 'Ben'),
  tryMacroId: (id: string) => id,
}));
vi.mock('@core/context/channels', () => ({
  useChannelsContext: () => ({ channelsById: () => new Map() }),
}));
vi.mock('@entity', () => ({
  Entity: {
    Title: (props: { entity: { name: string } }) => props.entity.name,
    Timestamp: () => 'now',
  },
  MaybeEntityRow: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({ mutedEntities: () => [] }),
}));
vi.mock('@app/features/home/components/HomeEntityIcon', () => ({
  HomeEntityIcon: (props: { entity: { type: string } }) => (
    <span data-entity-icon={props.entity.type} />
  ),
}));

afterEach(cleanup);

const notification = (
  tag: string,
  content: Record<string, unknown>,
  senderId: string | null = 'macro|ana'
): UnifiedNotification =>
  ({
    id: `${tag}-notification`,
    entity_id: 'entity',
    entity_type: 'channel',
    sender_id: senderId,
    state: 'unseen',
    created_at: '2026-11-19T10:00:00Z',
    updated_at: '2026-11-19T10:00:00Z',
    sent: true,
    viewed_at: null,
    notification_event_type: tag,
    notification_metadata: { tag, content },
  }) as UnifiedNotification;

const channel = {
  type: 'channel',
  id: 'support',
  name: 'support',
  channelType: 'public',
} as EntityData;

const thread = {
  type: 'channel_thread',
  id: 'root',
  name: 'support',
  ownerId: 'macro|ben',
  channelId: 'support',
  channelType: 'public',
  messageId: 'root',
  threadId: 'root',
  senderId: 'macro|ben',
  sender: { id: 'macro|ben', type: 'user' },
  content: 'The root message',
  attachments: [],
  reactions: [],
  thread: { replyCount: 1, preview: [] },
} as EntityData;

const document = { type: 'document', id: 'spec', name: 'Spec' } as EntityData;
const event = {
  type: 'calendar_event',
  id: 'standup',
  name: 'Standup',
} as EntityData;
const email = { type: 'email', id: 'mail', name: 'Invoice' } as EntityData;

const inboxRow = (
  type: InboxRowType,
  entity: EntityData,
  notifications: UnifiedNotification[],
  threadId?: string
): NotificationInboxRow => ({
  id: `${type}-row`,
  type,
  alsoListedAs: [],
  revision: '1',
  latestAt: Date.parse('2026-11-19T10:00:00Z'),
  threadId,
  actions: [],
  unseen: true,
  count: notifications.length,
  content: { entity, notifications },
});

/** What a row shows: its icon and its text, without the hover action. */
const shown = (container: HTMLElement) => {
  const row = container.querySelector<HTMLElement>('[data-home-item]');
  if (!row) throw new Error('No Home row rendered');
  const icon =
    row.querySelector('[data-entity-icon]')?.getAttribute('data-entity-icon') ??
    row.querySelector('svg')?.outerHTML;
  const text = [...row.childNodes]
    .filter(
      (node) => !(node instanceof HTMLElement && node.querySelector('button'))
    )
    .map((node) => node.textContent)
    .join('');
  return { icon, text };
};

const homeRow = (entity: EntityData, notifications: UnifiedNotification[]) => {
  const withNotifications: WithNotification<EntityData> = {
    ...entity,
    notifications: () => notifications,
  };
  return shown(
    render(() => (
      <HomeListEntity entity={withNotifications} occurrenceKey="home" />
    )).container
  );
};

const condensedRow = (row: NotificationInboxRow) =>
  shown(
    render(() => (
      <CondensedNotificationRow
        row={row}
        highlighted={false}
        onHover={() => {}}
        onClick={() => {}}
        onDone={() => {}}
      />
    )).container
  );

const reply = notification('channel_message_reply', {
  messageId: 'reply',
  threadId: 'root',
  channelType: 'public',
});
const mention = notification('channel_mention', {
  messageId: 'root',
  threadId: 'root',
  channelType: 'public',
});
const reaction = notification('channel_message_reaction', {
  messageId: 'root',
  threadId: 'root',
  channelType: 'public',
});
const message = notification('channel_message_send', {
  messageId: 'top',
  channelType: 'public',
});
const comment = notification('commented_on_document', { commentId: 'c1' });
const joinRequest = notification('calendar_event_join_request', {
  requestId: 'r1',
});
const newEmail = notification('new_email', { snippet: 'Due Friday' }, null);

describe('Condensed rows read as Home’s rows', () => {
  it.each([
    {
      kind: 'a thread reply',
      home: [thread, [reply]],
      inbox: inboxRow('channel_thread', channel, [reply], 'root'),
    },
    {
      kind: 'a mention in a thread',
      home: [thread, [mention]],
      inbox: inboxRow('channel_mention', channel, [mention], 'root'),
    },
    {
      kind: 'a reaction to a message',
      home: [thread, [reaction]],
      inbox: inboxRow('channel_messages', channel, [reaction], 'root'),
    },
    {
      kind: 'channel messages',
      home: [channel, [message]],
      inbox: inboxRow('channel_messages', channel, [message]),
    },
    {
      kind: 'a document comment',
      home: [document, [comment]],
      inbox: inboxRow('discussion_messages', document, [comment]),
    },
    {
      kind: 'a calendar join request',
      home: [event, [joinRequest]],
      inbox: inboxRow('calendar_join_request', event, [joinRequest]),
    },
    {
      kind: 'an email',
      home: [email, [newEmail]],
      inbox: inboxRow('email', email, [newEmail]),
    },
  ] as const)('$kind', ({ home, inbox }) => {
    const [entity, notifications] = home;
    expect(condensedRow(inbox)).toEqual(homeRow(entity, [...notifications]));
  });

  it('names a thread reply’s sender and channel', () => {
    expect(
      condensedRow(inboxRow('channel_thread', channel, [reply], 'root')).text
    ).toContain('Ana in #support');
  });
});
