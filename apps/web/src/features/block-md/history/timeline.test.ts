import { describe, expect, it } from 'vitest';
import {
  ACTIVE_TIME_MULTIPLIER,
  buildCompressedTimeline,
  SESSION_GAP_MS,
  warpedIntervalEnd,
} from './timeline';

const GAP = SESSION_GAP_MS;

describe('buildCompressedTimeline', () => {
  it('returns total 0 for empty input', () => {
    const result = buildCompressedTimeline([]);
    expect(result.intervals).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('single session produces one interval at offset 0', () => {
    const result = buildCompressedTimeline([{ startMs: 1000, endMs: 5000 }]);
    expect(result.intervals).toHaveLength(1);
    expect(result.intervals[0]).toMatchObject({
      startMs: 1000,
      endMs: 5000,
      warpStart: 0,
    });
    // Active editing time is stretched by ACTIVE_TIME_MULTIPLIER in warped space.
    expect(result.total).toBe(4000 * ACTIVE_TIME_MULTIPLIER);
  });

  it('floors zero-duration sessions to 1ms so intervals are non-empty', () => {
    const result = buildCompressedTimeline([{ startMs: 1000, endMs: 1000 }]);
    expect(result.intervals[0].endMs).toBe(1001);
    expect(result.total).toBe(1 * ACTIVE_TIME_MULTIPLIER);
  });

  it('merges sessions within the gap threshold into one interval', () => {
    const a = { startMs: 0, endMs: 1000 };
    const b = { startMs: 1000 + GAP, endMs: 2000 + GAP };
    const result = buildCompressedTimeline([a, b]);
    expect(result.intervals).toHaveLength(1);
  });

  it('keeps sessions beyond the gap as separate intervals', () => {
    const a = { startMs: 0, endMs: 1000 };
    const b = { startMs: 1000 + GAP + 1, endMs: 2000 + GAP + 1 };
    const result = buildCompressedTimeline([a, b]);
    expect(result.intervals).toHaveLength(2);
  });

  it('second interval warpStart is less than the real gap (compression)', () => {
    const a = { startMs: 0, endMs: 1000 };
    const bigGap = GAP * 100;
    const b = { startMs: 1000 + bigGap, endMs: 2000 + bigGap };
    const result = buildCompressedTimeline([a, b]);
    expect(result.intervals).toHaveLength(2);
    const realGap = b.startMs - a.endMs;
    const warpedGap =
      result.intervals[1].warpStart - warpedIntervalEnd(result.intervals[0]);
    expect(warpedGap).toBeLessThan(realGap);
  });

  it('larger real gaps produce larger warped gaps (compression is monotonic)', () => {
    const base = { startMs: 0, endMs: 1000 };
    const withSmall = buildCompressedTimeline([
      base,
      { startMs: 1000 + GAP * 2, endMs: 2000 + GAP * 2 },
    ]);
    const withLarge = buildCompressedTimeline([
      base,
      { startMs: 1000 + GAP * 100, endMs: 2000 + GAP * 100 },
    ]);
    const warpedSmall =
      withSmall.intervals[1].warpStart -
      warpedIntervalEnd(withSmall.intervals[0]);
    const warpedLarge =
      withLarge.intervals[1].warpStart -
      warpedIntervalEnd(withLarge.intervals[0]);
    expect(warpedLarge).toBeGreaterThan(warpedSmall);
  });

  it('sorts input before processing', () => {
    const a = { startMs: 0, endMs: 1000 };
    const b = { startMs: 1000 + GAP * 2, endMs: 2000 + GAP * 2 };
    const result = buildCompressedTimeline([b, a]); // b first, out of order
    expect(result.intervals[0].startMs).toBe(0);
    expect(result.intervals[1].startMs).toBe(b.startMs);
  });

  it('overlapping sessions are merged', () => {
    const a = { startMs: 0, endMs: 5000 };
    const b = { startMs: 3000, endMs: 8000 };
    const result = buildCompressedTimeline([a, b]);
    expect(result.intervals).toHaveLength(1);
    expect(result.intervals[0].endMs).toBe(8000);
  });

  it('warpedIntervalEnd equals warpStart + stretched duration', () => {
    const result = buildCompressedTimeline([
      { startMs: 0, endMs: 1000 },
      { startMs: 1000 + GAP * 10, endMs: 2000 + GAP * 10 },
    ]);
    for (const iv of result.intervals) {
      expect(warpedIntervalEnd(iv)).toBe(
        iv.warpStart + (iv.endMs - iv.startMs) * ACTIVE_TIME_MULTIPLIER
      );
    }
  });
});
