import type { UnifiedNotification } from '@notifications/types';
import { describe, expect, it } from 'vitest';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';
import type { InboxActor } from '../core/inbox-row';
import { describeInboxRow } from './describe-row';

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
