import { describe, expect, it } from 'vitest';
import {
  type InboxUnreadCount,
  MAIL_ROW_TYPES,
  unreadChatRows,
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
      unreadRows(counts, { rowTypes: MAIL_ROW_TYPES, passwords: true })
    ).toBe(4);
    expect(unreadRows(counts, { rowTypes: ['task'], passwords: true })).toBe(3);
  });

  it('counts vault access requests only for viewers the inbox shows them to', () => {
    expect(unreadRows(counts, { passwords: true })).toBe(16);
    expect(unreadRows(counts, { passwords: false })).toBe(11);
  });
});

describe('unreadChatRows', () => {
  it('counts the rows the server says Chat shows, of kinds this build does not know too', () => {
    expect(
      unreadChatRows([
        { type: 'email', passwordRequests: false, count: 4, chatCount: 0 },
        {
          type: 'channel_thread',
          passwordRequests: false,
          count: 5,
          chatCount: 2,
        },
        { type: 'other', passwordRequests: false, count: 3, chatCount: 1 },
      ])
    ).toBe(3);
  });

  it('counts every channel row when the server does not say', () => {
    expect(unreadChatRows(counts)).toBe(3);
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
