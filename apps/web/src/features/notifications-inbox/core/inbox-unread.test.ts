import { describe, expect, it } from 'vitest';
import {
  CHANNEL_ROW_TYPES,
  type InboxUnreadCount,
  MAIL_ROW_TYPES,
  unreadLabel,
  unreadRows,
} from './inbox-unread';

const counts: InboxUnreadCount[] = [
  { type: 'email', passwordRequests: false, count: 4 },
  { type: 'channel_mention', passwordRequests: false, count: 1 },
  { type: 'channel_thread', passwordRequests: false, count: 2 },
  { type: 'task', passwordRequests: false, count: 3 },
  { type: 'access_requested', passwordRequests: false, count: 1 },
  { type: 'access_requested', passwordRequests: true, count: 5 },
];

describe('unreadRows', () => {
  it('counts each section from its own kinds', () => {
    expect(
      unreadRows(counts, { rowTypes: CHANNEL_ROW_TYPES, passwords: true })
    ).toBe(3);
    expect(
      unreadRows(counts, { rowTypes: MAIL_ROW_TYPES, passwords: true })
    ).toBe(4);
  });

  it('counts vault access requests only for viewers the inbox shows them to', () => {
    expect(unreadRows(counts, { passwords: true })).toBe(16);
    expect(unreadRows(counts, { passwords: false })).toBe(11);
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
