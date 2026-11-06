import { isWithNotification } from '@entity/types/notification';
import type {
  NotificationInboxActorKind,
  NotificationInboxEntryFieldsFragment,
  NotificationInboxRowActionKind,
  NotificationInboxRowType,
} from '@service-storage/graphql/generated/graphql';
import { mapGraphqlNotification } from '@service-storage/graphql-soup';
import { describe, expect, it, vi } from 'vitest';
import { ALL_INBOX_ROW_TYPES } from '../core/inbox-filters';
import { rowEntity } from '../primitives/row-entity';
import { commentNotification, inboxEntry } from '../tests/wire';
import { encodeInboxScope, toInboxGroup } from './decode';

// Row mapping imports allBlocks, which loads every block module; one of them
// opens a websocket that jsdom rejects after the test ends.
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'Untitled',
  itemToSafeName: (item: { name?: string }) => item.name ?? 'Untitled',
}));

/** A channel's inbox entry holding one thread row with one reply. */
const threadRowEntry = () =>
  ({
    groupId: 'channel:ch-a',
    sortAt: '2026-02-01T10:09:00Z',
    entity: {
      __typename: 'GraphqlSoupChannel',
      id: 'ch-a',
      entityType: 'CHANNEL',
      channelName: 'General',
      channelType: 'PUBLIC',
      ownerId: 'macro|viewer@example.com',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      participants: [],
    },
    rows: [
      {
        id: 'channel:ch-a#thread:root',
        rowType: 'CHANNEL_THREAD',
        revision: 'rev',
        latestAt: '2026-02-01T10:09:00Z',
        unseen: true,
        count: 1,
        actor: null,
        actions: [],
        notifications: [
          {
            ...commentNotification('ch-a', 'n-1', '2026-02-01T10:09:00Z'),
            eventType: 'channel_message_reply',
            entityType: 'CHANNEL',
            targetEntityType: 'CHANNEL',
            metadata: {
              __typename: 'GraphqlChannelReplyMetadata',
              channelReplyThreadId: 'root',
              channelReplyMessageId: 'reply',
              channelReplyUserId: 'macro|colleague@example.com',
              channelReplySenderDisplayName: null,
              channelReplySenderClientKind: null,
              channelReplyMessageContent: 'on it',
              channelReplyHasAttachments: false,
              channelReplyThreadParentSenderId: null,
              channelReplyChannelType: 'PUBLIC',
              channelReplyChannelName: 'General',
              channelReplySenderProfilePictureUrl: null,
            },
          },
        ],
      },
    ],
  }) as unknown as NotificationInboxEntryFieldsFragment;

describe('toInboxGroup', () => {
  it('gives a row’s entity the accessor that navigation helpers read', () => {
    const [row] =
      toInboxGroup(
        inboxEntry({
          docId: 'doc-a',
          sortAt: '2026-02-01T10:09:00Z',
          rows: [
            {
              id: 'document:doc-a#discussion_thread:c1',
              rowType: 'DISCUSSION_THREAD',
              latestAt: '2026-02-01T10:09:00Z',
              notificationIds: ['c1'],
            },
          ],
        })
      )?.rows ?? [];

    expect(row && isWithNotification(rowEntity(row))).toBe(true);
  });

  it('points a channel row at the message its newest notification names', () => {
    const [row] = toInboxGroup(threadRowEntry())?.rows ?? [];

    expect(row && rowEntity(row)).toMatchObject({
      type: 'channel',
      target: { messageId: 'reply', threadId: 'root' },
    });
  });

  it('aims a row’s entity at one of its notifications', () => {
    const entry = threadRowEntry();
    const [row] = entry.rows;
    const older = {
      ...row.notifications[0],
      id: 'n-0',
      metadata: {
        ...row.notifications[0].metadata,
        channelReplyMessageId: 'older-reply',
      },
    };
    const group = toInboxGroup({
      ...entry,
      rows: [
        { ...row, count: 2, notifications: [row.notifications[0], older] },
      ],
    } as unknown as NotificationInboxEntryFieldsFragment);
    const decoded = group?.rows[0];
    if (!decoded) throw new Error('row missing');
    expect(rowEntity(decoded)).toMatchObject({
      target: { messageId: 'reply', threadId: 'root' },
    });

    const aimed = rowEntity(decoded, decoded.content.notifications[1]);

    expect(aimed).toMatchObject({
      target: { messageId: 'older-reply', threadId: 'root' },
    });
    expect(isWithNotification(aimed) && aimed.notifications?.()).toEqual([
      decoded.content.notifications[1],
    ]);
  });

  it('turns each row into an inbox row whose entity carries only its notifications', () => {
    const group = toInboxGroup(
      inboxEntry({
        docId: 'doc-a',
        sortAt: '2026-02-01T10:09:00Z',
        rows: [
          {
            id: 'document:doc-a#discussion_mention:t1',
            rowType: 'DISCUSSION_MENTION',
            latestAt: '2026-02-01T10:09:00Z',
            notificationIds: ['n-1', 'n-2'],
          },
          {
            id: 'document:doc-a#task',
            rowType: 'TASK',
            latestAt: '2026-02-01T10:01:00Z',
            unseen: false,
          },
        ],
      })
    );

    expect(group?.groupId).toBe('document:doc-a');
    expect(group?.sortAt).toBe(Date.parse('2026-02-01T10:09:00Z'));
    expect(
      group?.rows.map((row) => ({
        id: row.id,
        type: row.type,
        unseen: row.unseen,
        count: row.count,
        notifications: row.content.notifications.map((n) => n.id),
        entityNotifications: (
          rowEntity(row).notifications as () => { id: string }[]
        )().map((n) => n.id),
      }))
    ).toEqual([
      {
        id: 'document:doc-a#discussion_mention:t1',
        type: 'discussion_mention',
        unseen: true,
        count: 2,
        notifications: ['n-1', 'n-2'],
        entityNotifications: ['n-1', 'n-2'],
      },
      {
        id: 'document:doc-a#task',
        type: 'task',
        unseen: false,
        count: 1,
        notifications: ['n-document:doc-a#task'],
        entityNotifications: ['n-document:doc-a#task'],
      },
    ]);
  });

  it('reads who a row is from and what the viewer can do', () => {
    const group = toInboxGroup(
      inboxEntry({
        docId: 'doc-a',
        sortAt: '2026-02-01T10:09:00Z',
        rows: [
          {
            id: 'document:doc-a#access_requested:r1',
            rowType: 'ACCESS_REQUESTED',
            latestAt: '2026-02-01T10:09:00Z',
            actor: {
              kind: 'USER',
              principalId: 'macro|ana@example.com',
              name: null,
            },
            actions: [
              { kind: 'APPROVE', targetId: 'r1', url: null },
              { kind: 'DENY', targetId: 'r1', url: null },
            ],
          },
          {
            id: 'document:doc-a#agent',
            rowType: 'AGENT',
            latestAt: '2026-02-01T10:08:00Z',
            actor: { kind: 'AGENT', principalId: 'bot-1', name: 'Builder' },
            actions: [{ kind: 'ANSWER', targetId: null, url: null }],
          },
          {
            id: 'document:doc-a#email',
            rowType: 'EMAIL',
            latestAt: '2026-02-01T10:07:00Z',
            actor: null,
          },
        ],
      })
    );

    expect(
      group?.rows.map((row) => ({ actor: row.actor, actions: row.actions }))
    ).toEqual([
      {
        actor: { kind: 'user', id: 'macro|ana@example.com' },
        actions: [
          { kind: 'approve', targetId: 'r1' },
          { kind: 'deny', targetId: 'r1' },
        ],
      },
      {
        actor: { kind: 'agent', name: 'Builder' },
        actions: [{ kind: 'answer' }],
      },
      { actor: undefined, actions: [] },
    ]);
  });

  it('shows values a newer server adds as a generic row, with no author and no button', () => {
    const group = toInboxGroup(
      inboxEntry({
        docId: 'doc-a',
        sortAt: '2026-02-01T10:09:00Z',
        rows: [
          {
            id: 'document:doc-a#suggestion:s1',
            rowType: 'SUGGESTION' as NotificationInboxRowType,
            latestAt: '2026-02-01T10:09:00Z',
            actor: {
              kind: 'TEAM' as NotificationInboxActorKind,
              principalId: null,
              name: null,
            },
            actions: [
              {
                kind: 'SEND' as NotificationInboxRowActionKind,
                targetId: 's1',
                url: null,
              },
              { kind: 'APPROVE', targetId: null, url: null },
              { kind: 'REVIEW', targetId: null, url: null },
              { kind: 'OPEN', targetId: null, url: null },
            ],
          },
        ],
      })
    );

    expect(group?.rows).toHaveLength(1);
    expect(group?.rows[0]).toMatchObject({
      type: 'other',
      actor: { kind: 'other' },
      actions: [{ kind: 'open' }],
    });
  });

  it('drops an entry without a valid place', () => {
    expect(
      toInboxGroup(inboxEntry({ docId: 'doc-a', sortAt: 'never', rows: [] }))
    ).toBeNull();
  });
});

describe('mapGraphqlNotification', () => {
  it('carries the verified MCP client of a bot reply', () => {
    const notification = mapGraphqlNotification({
      ...commentNotification('ch-a', 'n-1', '2026-02-01T10:09:00Z'),
      eventType: 'channel_message_reply',
      entityType: 'CHANNEL',
      targetEntityType: 'CHANNEL',
      metadata: {
        __typename: 'GraphqlChannelReplyMetadata',
        channelReplyThreadId: 'root',
        channelReplyMessageId: 'reply',
        channelReplyUserId: null,
        channelReplySenderDisplayName: 'Claude Code (macro)',
        channelReplySenderClientKind: 'CLAUDE_CODE',
        channelReplyMessageContent: 'on it',
        channelReplyHasAttachments: false,
        channelReplyThreadParentSenderId: null,
        channelReplyChannelType: 'PUBLIC',
        channelReplyChannelName: 'General',
        channelReplySenderProfilePictureUrl: null,
      },
    } as unknown as Parameters<typeof mapGraphqlNotification>[0]);

    expect(notification.notification_metadata).toMatchObject({
      tag: 'channel_message_reply',
      content: {
        senderDisplayName: 'Claude Code (macro)',
        senderClientKind: 'claude_code',
      },
    });
  });
});

describe('encodeInboxScope', () => {
  it('reads every row, new types included, when every type is chosen', () => {
    expect(encodeInboxScope({ rowTypes: ALL_INBOX_ROW_TYPES })).toEqual({
      rowTypes: [],
    });
  });

  it('narrows the inbox to the chosen rows', () => {
    expect(encodeInboxScope({ rowTypes: ['email', 'channel_thread'] })).toEqual(
      { rowTypes: ['EMAIL', 'CHANNEL_THREAD'] }
    );
  });

  it('asks the server for unread rows only when the scope is unread', () => {
    expect(
      encodeInboxScope({ rowTypes: ALL_INBOX_ROW_TYPES, unreadOnly: true })
    ).toEqual({ rowTypes: [], unreadOnly: true });
  });
});
