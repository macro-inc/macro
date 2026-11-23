import { describe, expect, it } from 'vitest';
import { hasUnseenPicks, parseSeenPicks, seenAfterShowing } from './discover';

describe('the Discover dot', () => {
  it('shows while an AI pick hasn’t been seen on Discover', () => {
    expect(hasUnseenPicks(['a', 'b'], ['a'])).toBe(true);
    expect(hasUnseenPicks(['a'], ['a', 'gone'])).toBe(false);
    expect(hasUnseenPicks([], [])).toBe(false);
  });

  it('stays off until it is known what the person saw', () => {
    expect(hasUnseenPicks(['a'], undefined)).toBe(false);
  });

  it('remembers what Discover showed, and reads anything else as nothing seen', () => {
    const seen = seenAfterShowing(['a', 'b']);
    expect(parseSeenPicks(JSON.stringify(seen))).toEqual(['a', 'b']);
    expect(parseSeenPicks(null)).toEqual([]);
    expect(parseSeenPicks('not json')).toEqual([]);
    expect(parseSeenPicks('{"a":1}')).toEqual([]);
    expect(seenAfterShowing(Array.from({ length: 300 }, String))).toHaveLength(
      200
    );
  });
});
