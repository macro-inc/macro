import { describe, expect, it } from 'vitest';
import type { MessageListItem } from './generated/schemas/messageListItem';
import type { TimelineActivity } from './generated/schemas/timelineActivity';
import { toTimelinePage } from './messages';

const message = (id: string, created_at: string) =>
  ({ id, created_at }) as MessageListItem;
const activity = (id: string, occurred_at: string): TimelineActivity => ({
  id,
  occurred_at,
  actor_id: 'macro|a@example.com',
  action: 'renamed',
});
const keys = (page: ReturnType<typeof toTimelinePage>) =>
  page.entries.map((entry) =>
    entry.type === 'message'
      ? entry.message.id
      : `activity:${entry.activity.id}`
  );

describe('toTimelinePage', () => {
  it('interleaves both newest-first lists by position and keeps cursors', () => {
    const next = { id: 'a0', created_at: '2026-09-10T10:00:00Z' };
    const page = toTimelinePage({
      items: [
        message('m3', '2026-09-10T13:00:00Z'),
        message('m1', '2026-09-10T11:00:00Z'),
      ],
      activity: [
        activity('a4', '2026-09-10T14:00:00Z'),
        activity('a2', '2026-09-10T12:00:00Z'),
        activity('a0', '2026-09-10T10:00:00Z'),
      ],
      next_cursor: next,
      previous_cursor: null,
    });
    expect(keys(page)).toEqual([
      'activity:a4',
      'm3',
      'activity:a2',
      'm1',
      'activity:a0',
    ]);
    expect(page.next_cursor).toEqual(next);
    expect(page.previous_cursor).toBeNull();
  });

  it('keeps the server message order when a page has no activity', () => {
    const page = toTimelinePage({
      items: [
        message('b', '2026-09-10T11:00:00Z'),
        message('a', '2026-09-10T11:00:00Z'),
      ],
    });
    expect(keys(page)).toEqual(['b', 'a']);
  });
});
