import { expect, it } from 'vitest';
import type { EmailEntity } from '../types/entity';
import type { Notification, WithNotification } from '../types/notification';
import { unreadFilterFn } from './filter';

it('shows an unseen reminder dot on a read email without changing mailbox state', () => {
  let state = 'unseen';
  const email = {
    type: 'email',
    id: 'thread',
    isRead: true,
    notifications: () => [
      {
        entity_type: 'email_thread',
        notification_event_type: 'reminder',
        state,
      } as Notification,
    ],
  } as WithNotification<EmailEntity>;
  expect(unreadFilterFn(email)).toBe(true);
  expect(email.isRead).toBe(true);
  state = 'seen';
  expect(unreadFilterFn(email)).toBe(false);
  state = 'done';
  expect(unreadFilterFn(email)).toBe(false);
});

it('reads a GraphQL soup reminder array on a read email', () => {
  const email = {
    type: 'email',
    id: 'thread',
    isRead: true,
    notifications: [
      {
        entity_type: 'email_thread',
        notification_event_type: 'reminder',
        state: 'unseen',
      } as Notification,
    ],
  } as WithNotification<EmailEntity>;
  expect(unreadFilterFn(email)).toBe(true);
});

it('keeps ordinary new-mail dots tied to mailbox read state', () => {
  const email = {
    type: 'email',
    isRead: true,
    notifications: () => [
      {
        entity_type: 'email_thread',
        notification_event_type: 'new_email',
        state: 'unseen',
      } as Notification,
    ],
  } as WithNotification<EmailEntity>;
  expect(unreadFilterFn(email)).toBe(false);
  expect(unreadFilterFn({ ...email, isRead: false })).toBe(true);
});
