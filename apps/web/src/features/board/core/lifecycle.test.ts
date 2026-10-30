import { describe, expect, it } from 'vitest';
import { boardItem, HOUR, MINUTE, NOW } from '../tests/items';
import { isOnBoard, itemFreshness } from './lifecycle';

describe('itemFreshness', () => {
  it('marks activity in the last few minutes as live, read or not', () => {
    const item = boardItem('a', { lastActivityAt: NOW - 2 * MINUTE });

    expect(itemFreshness(item, undefined, NOW)).toBe('live');
  });

  it('keeps unread and needs-you items fresh however old they are', () => {
    const old = NOW - 5 * 24 * HOUR;

    expect(
      itemFreshness(
        boardItem('a', { lastActivityAt: old, unreadCount: 2 }),
        undefined,
        NOW
      )
    ).toBe('fresh');
    expect(
      itemFreshness(
        boardItem('b', { lastActivityAt: old, needsYou: true }),
        undefined,
        NOW
      )
    ).toBe('fresh');
  });

  it('settles read items after a quiet spell and expires them after a day', () => {
    expect(
      itemFreshness(
        boardItem('a', { lastActivityAt: NOW - HOUR }),
        undefined,
        NOW
      )
    ).toBe('fresh');
    expect(
      itemFreshness(
        boardItem('b', { lastActivityAt: NOW - 5 * HOUR }),
        undefined,
        NOW
      )
    ).toBe('settled');
    expect(
      itemFreshness(
        boardItem('c', { lastActivityAt: NOW - 30 * HOUR }),
        undefined,
        NOW
      )
    ).toBe('expired');
  });

  it('restarts the quiet clock when the item was opened from the board', () => {
    const item = boardItem('a', { lastActivityAt: NOW - 30 * HOUR });

    expect(itemFreshness(item, { seenAt: NOW - 10 * MINUTE }, NOW)).toBe(
      'fresh'
    );
  });

  it('keeps items moved by hand instead of expiring them', () => {
    const item = boardItem('a', { lastActivityAt: NOW - 30 * HOUR });

    expect(itemFreshness(item, { pinned: true }, NOW)).toBe('settled');
  });

  it('hides a closed item until something new happens in it', () => {
    const item = boardItem('a', {
      lastActivityAt: NOW - HOUR,
      unreadCount: 1,
    });
    const recall = { dismissedAt: NOW - HOUR };

    expect(itemFreshness(item, recall, NOW)).toBe('dismissed');
    expect(
      itemFreshness({ ...item, lastActivityAt: NOW - MINUTE }, recall, NOW)
    ).toBe('live');
  });
});

describe('isOnBoard', () => {
  it('shows expired items only on request and never dismissed ones', () => {
    expect(isOnBoard('expired', false)).toBe(false);
    expect(isOnBoard('expired', true)).toBe(true);
    expect(isOnBoard('settled', false)).toBe(true);
    expect(isOnBoard('dismissed', true)).toBe(false);
  });
});
