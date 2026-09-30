import type { UnifiedNotification } from '@notifications/types';
import { describe, expect, it } from 'vitest';
import { reminderAlertsFromNotifications } from './reminder-alerts';

const notification: UnifiedNotification = {
  id: 'delivery-1',
  entity_id: 'reminder-1',
  entity_type: 'reminder',
  created_at: '2026-09-21T10:00:00Z',
  updated_at: '2026-09-21T10:00:00Z',
  state: 'unseen',
  sent: true,
  notification_event_type: 'reminder',
  notification_metadata: {
    tag: 'reminder',
    content: {
      reminderId: 'reminder-1',
      description: 'Follow up',
      scheduledFor: '2026-09-21T10:00:00Z',
    },
  },
};

describe('reminder notification decoding', () => {
  it('deduplicates replays by occurrence rather than reminder or delivery id', () => {
    const replay = { ...notification, id: 'delivery-2' };
    const next: UnifiedNotification = {
      ...notification,
      id: 'delivery-3',
      notification_metadata: {
        tag: 'reminder',
        content: {
          reminderId: 'reminder-1',
          description: 'Follow up',
          scheduledFor: '2026-09-22T10:00:00Z',
        },
      },
    };
    expect(
      reminderAlertsFromNotifications([notification, replay, next])
    ).toHaveLength(2);
  });

  it('excludes deleted, seen, done, and non-reminder notifications', () => {
    expect(
      reminderAlertsFromNotifications([
        { ...notification, deleted_at: '2026-09-21T11:00:00Z' },
        { ...notification, state: 'seen' },
        { ...notification, state: 'done' },
        {
          ...notification,
          notification_metadata: {
            tag: 'channel_invite',
            content: { channelName: 'General', invitedBy: 'user-1' },
          },
        },
      ])
    ).toEqual([]);
  });

  it('does not resurrect an occurrence with an already-seen duplicate', () => {
    expect(
      reminderAlertsFromNotifications([
        notification,
        { ...notification, id: 'replay', state: 'seen' },
      ])
    ).toEqual([]);
  });

  it('uses delivery identity for legacy reminders without a scheduled instant', () => {
    const legacy: UnifiedNotification = {
      ...notification,
      notification_metadata: {
        tag: 'reminder',
        content: { reminderId: 'reminder-1', description: '' },
      },
    };
    expect(reminderAlertsFromNotifications([legacy])).toEqual([
      {
        key: 'delivery-1',
        reminderId: 'reminder-1',
        description: 'Reminder',
        scheduledFor: undefined,
      },
    ]);
  });
});
