import { describe, expect, it } from 'vitest';
import { type ActivitySession, buildActivityRows } from './activityRows';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const NOW = new Date('2026-06-25T12:00:00Z').getTime();

function session(
  userId: string,
  endAgoMs: number,
  durationMs = MINUTE,
  count = 1
): ActivitySession {
  const endMs = NOW - endAgoMs;
  return { userId, startMs: endMs - durationMs, endMs, count };
}

describe('buildActivityRows', () => {
  it('groups recent edits from multiple users into the same progressive tier', () => {
    const rows = buildActivityRows(
      [session('wolf', 2 * MINUTE), session('bob', 6 * MINUTE)],
      NOW
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].userIds).toEqual(['wolf', 'bob']);
    expect(rows[0].label).toBe('2 minutes ago');
  });

  it('skips empty tiers and groups older users by their broader tier', () => {
    const rows = buildActivityRows(
      [
        session('bob', 2 * DAY),
        session('sarah', 2 * DAY + HOUR),
        session('joseph', 2 * DAY + 2 * HOUR),
      ],
      NOW
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].userIds).toEqual(['bob', 'sarah', 'joseph']);
    expect(rows[0].label).toBe('2 days ago');
  });

  it('splits rows when active span exceeds the tier max span', () => {
    const rows = buildActivityRows(
      [session('wolf', 12 * MINUTE), session('bob', 55 * MINUTE, 20 * MINUTE)],
      NOW
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].userIds).toEqual(['wolf']);
    expect(rows[1].userIds).toEqual(['bob']);
  });
});
