import { expect, it } from 'vitest';
import {
  getNotificationAction,
  getNotificationContent,
  getNotificationTargetName,
} from '../notification-metadata';
import { getThreadId, stackNotifications } from '../notification-stacking';
import type { UnifiedNotification } from '../types';

function notification(
  id: string,
  project: string,
  thread: string,
  reason: 'mention' | 'reply' | 'owner' = 'owner'
): UnifiedNotification {
  return {
    id,
    entity_id: project,
    entity_type: 'initiative',
    created_at: `2026-09-22T12:00:0${id}Z`,
    notification_metadata: {
      tag: 'initiative_discussion',
      content: {
        projectName: 'Launch',
        owner: 'user',
        reason,
        messageId: id,
        threadId: thread,
        text: 'Ready to ship',
      },
    },
  } as UnifiedNotification;
}
it('keeps project discussions grouped by parent and thread', () => {
  const groups = stackNotifications([
    notification('1', 'a', 'thread'),
    notification('2', 'a', 'thread', 'reply'),
    notification('3', 'a', 'other'),
    notification('4', 'b', 'thread'),
  ]);
  expect(groups.map((g) => g.notifications.map((n) => n.id))).toEqual([
    ['4'],
    ['3'],
    ['2', '1'],
  ]);
  expect(getThreadId(groups[2])).toBe('thread');
});
it('renders project names, comment previews, and mention/reply reasons', () => {
  const mention = notification('1', 'a', 'thread', 'mention');
  expect(getNotificationTargetName(mention)).toBe('Launch');
  expect(getNotificationContent(mention)).toBe('Ready to ship');
  expect(getNotificationAction(mention)).toBe('mentioned you in a comment on');
  expect(getNotificationAction(notification('2', 'a', 'thread', 'reply'))).toBe(
    'replied to a comment on'
  );
});
