import { describe, expect, it } from 'vitest';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';
import {
  type NotificationInboxGroup,
  orderInboxRows,
} from './notification-inbox-groups';

const row = (id: string, latestAt: number): NotificationInboxRow => ({
  id,
  type: 'channel_messages',
  revision: `rev-${id}`,
  latestAt,
  actions: [],
  unseen: true,
  count: 1,
  content: { entity: {} as never, notifications: [] },
});

const group = (
  groupId: string,
  sortAt: number,
  rows: NotificationInboxRow[]
): NotificationInboxGroup => ({ groupId, sortAt, rows });

const ids = (rows: NotificationInboxRow[]) => rows.map((r) => r.id);

describe('orderInboxRows', () => {
  it('lists every row of the loaded groups newest first', () => {
    const groups = [
      group('channel:a', 50, [
        row('channel:a#top_level', 50),
        row('channel:a#thread:m', 45),
      ]),
      group('document:b', 48, [row('document:b#task', 48)]),
    ];
    expect(ids(orderInboxRows(groups, true))).toEqual([
      'channel:a#top_level',
      'document:b#task',
      'channel:a#thread:m',
    ]);
  });

  it('holds back rows an unloaded page could outrank until it loads', () => {
    const groups = [
      group('channel:a', 50, [
        row('channel:a#top_level', 50),
        row('channel:a#thread:m', 10),
      ]),
      group('document:b', 30, [row('document:b#task', 30)]),
    ];
    // The next page holds groups placed at or before 30, so the thread at
    // 10 may not be next yet.
    expect(ids(orderInboxRows(groups, false))).toEqual([
      'channel:a#top_level',
      'document:b#task',
    ]);
    expect(ids(orderInboxRows(groups, true))).toEqual([
      'channel:a#top_level',
      'document:b#task',
      'channel:a#thread:m',
    ]);
  });

  it('shows nothing before the first page loads', () => {
    expect(orderInboxRows([], false)).toEqual([]);
  });

  it('keeps rows at the same time in a stable order', () => {
    const groups = [
      group('document:b', 20, [row('document:b#task', 20)]),
      group('document:a', 20, [row('document:a#task', 20)]),
    ];
    expect(ids(orderInboxRows(groups, true))).toEqual([
      'document:b#task',
      'document:a#task',
    ]);
  });
});
