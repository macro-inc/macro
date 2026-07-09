import { describe, expect, it } from 'vitest';
import {
  BOGUS_BLANK_MARKDOWN_GOLDEN_SNAPSHOT_HISTORY_MS as GOLDEN_MS,
  sessionize,
} from './sessionize';

const GAP = 100;
const ev = (userId: string, tMs: number) => ({ userId, tMs });

describe('sessionize', () => {
  it('empty', () => {
    expect(sessionize([], GAP)).toEqual([]);
  });

  it('single event', () => {
    expect(sessionize([ev('a', 1000)], GAP)).toEqual([
      { userId: 'a', startMs: 1000, endMs: 1000, count: 1 },
    ]);
  });

  it('two within gap merge into one session', () => {
    const sessions = sessionize([ev('a', 1000), ev('a', 1050)], GAP);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ startMs: 1000, endMs: 1050, count: 2 });
  });

  it('two beyond gap split, most recent first', () => {
    const sessions = sessionize([ev('a', 1000), ev('a', 1200)], GAP);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ startMs: 1200, count: 1 });
    expect(sessions[1]).toMatchObject({ startMs: 1000, count: 1 });
  });

  it('unsorted input grouped correctly', () => {
    const sessions = sessionize(
      [ev('a', 1050), ev('a', 1000), ev('a', 1025)],
      GAP
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ startMs: 1000, endMs: 1050, count: 3 });
  });

  it('multiple users', () => {
    const sessions = sessionize(
      [
        ev('a', 9000),
        ev('b', 5000),
        ev('a', 1050),
        ev('b', 1010),
        ev('a', 1000),
      ],
      GAP
    );
    expect(sessions).toHaveLength(4);
    expect(sessions[0]).toMatchObject({ endMs: 9000, userId: 'a' });
    expect(sessions[1]).toMatchObject({ endMs: 5000, userId: 'b' });
    const aOld = sessions.find((s) => s.userId === 'a' && s.startMs === 1000);
    expect(aOld).toMatchObject({ endMs: 1050, count: 2 });
  });

  it('filters the lone bogus golden-snapshot session', () => {
    const sessions = sessionize([ev('a', GOLDEN_MS)], GAP);
    expect(sessions).toEqual([]);
  });
});
