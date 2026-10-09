import { describe, expect, it } from 'vitest';
import { compareTimelinePositions } from './message-timeline';

describe('timeline positions', () => {
  it('uses microseconds before UUIDs and handles equivalent date representations', () => {
    expect(
      compareTimelinePositions(
        { id: 'z', createdAt: '2026-09-19T12:00:00.000001Z' },
        { id: 'a', createdAt: '2026-09-19T12:00:00.000002Z' }
      )
    ).toBeLessThan(0);
    expect(
      compareTimelinePositions(
        { id: 'a', createdAt: '2026-09-19T12:00:00Z' },
        { id: 'a', createdAt: '2026-09-19T12:00:00.000+00:00' }
      )
    ).toBe(0);
  });
});
