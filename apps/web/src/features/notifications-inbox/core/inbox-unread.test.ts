import { describe, expect, it } from 'vitest';
import { type InboxUnreadCount, unreadLabel, unreadRows } from './inbox-unread';

const counts: InboxUnreadCount[] = [
  { type: 'email', passwordRequests: false, count: 4 },
  { type: 'channel_mention', passwordRequests: false, count: 1 },
  { type: 'channel_thread', passwordRequests: false, count: 2 },
  { type: 'task', passwordRequests: false, count: 3 },
  { type: 'other', passwordRequests: false, count: 1 },
  { type: 'access_requested', passwordRequests: false, count: 1 },
  { type: 'access_requested', passwordRequests: true, count: 5 },
];

describe('unreadRows', () => {
  it('counts every kind the inbox lists, unknown kinds included', () => {
    expect(unreadRows(counts, { passwords: true })).toBe(17);
  });

  it('counts vault access requests only for viewers the inbox shows them to', () => {
    expect(unreadRows(counts, { passwords: false })).toBe(12);
  });
});

describe('unreadLabel', () => {
  it('shows nothing at zero and stops at 99+', () => {
    expect(unreadLabel(0)).toBeUndefined();
    expect(unreadLabel(7)).toBe('7');
    expect(unreadLabel(99)).toBe('99');
    expect(unreadLabel(100)).toBe('99+');
    expect(unreadLabel(340)).toBe('99+');
  });
});
