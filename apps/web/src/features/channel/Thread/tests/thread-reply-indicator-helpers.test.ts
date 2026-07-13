import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VISIBLE_REPLY_COUNT,
  getCollapsedRepliesCount,
  getThreadLatestReplyAt,
  getThreadReplyCountLabel,
  getUniqueReplyUserIds,
} from '../utils/thread-reply-indicator-helpers';

describe('thread-reply-indicator-helpers', () => {
  it('computes the number of collapsed replies', () => {
    expect(getCollapsedRepliesCount(0, DEFAULT_VISIBLE_REPLY_COUNT)).toBe(0);
    expect(getCollapsedRepliesCount(2, DEFAULT_VISIBLE_REPLY_COUNT)).toBe(0);
    expect(getCollapsedRepliesCount(5, DEFAULT_VISIBLE_REPLY_COUNT)).toBe(2);
  });

  it('formats collapsed reply labels', () => {
    expect(getThreadReplyCountLabel(1)).toBe('1 more reply');
    expect(getThreadReplyCountLabel(2)).toBe('2 more replies');
  });

  it('returns unique user ids in reply order', () => {
    const userIds = getUniqueReplyUserIds(
      [
        { sender_id: 'u1' },
        { sender_id: 'u2' },
        { sender_id: 'u1' },
        { sender_id: 'u3' },
      ],
      4
    );

    expect(userIds).toEqual(['u1', 'u2', 'u3']);
  });

  it('limits the number of unique users', () => {
    const userIds = getUniqueReplyUserIds(
      [{ sender_id: 'u1' }, { sender_id: 'u2' }, { sender_id: 'u3' }],
      2
    );

    expect(userIds).toEqual(['u1', 'u2']);
  });

  it('prefers explicit latest reply timestamp when present', () => {
    const latest = getThreadLatestReplyAt('2026-02-24T12:00:00.000Z', [
      { created_at: '2026-02-23T12:00:00.000Z' },
    ]);

    expect(latest).toBe('2026-02-24T12:00:00.000Z');
  });

  it('falls back to the last reply timestamp when latest is missing', () => {
    const latest = getThreadLatestReplyAt(undefined, [
      { created_at: '2026-02-23T12:00:00.000Z' },
      { created_at: '2026-02-24T12:00:00.000Z' },
    ]);

    expect(latest).toBe('2026-02-24T12:00:00.000Z');
  });
});
