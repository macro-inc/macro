import type {
  NotificationInboxActorKind,
  NotificationInboxRowActionKind,
  NotificationInboxRowType,
} from '@service-storage/graphql/generated/graphql';
import { describe, expect, it, vi } from 'vitest';
import { ALL_INBOX_ROW_TYPES } from '../core/inbox-filters';
import { inboxEntry } from '../tests/wire';
import { encodeInboxScope, toInboxGroup } from './decode';

// Row mapping imports allBlocks, which loads every block module; one of them
// opens a websocket that jsdom rejects after the test ends.
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'Untitled',
  itemToSafeName: (item: { name?: string }) => item.name ?? 'Untitled',
}));

describe('toInboxGroup', () => {
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
          row.content.entity.notifications as { id: string }[]
        ).map((n) => n.id),
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
});
