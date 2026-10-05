import { describe, expect, it } from 'vitest';
import { initialsOf, relativeTime, stackMarkers } from './comments';

describe('relative times', () => {
  const now = new Date('2026-10-04T15:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it('reads like PowerPoint’s Comments pane', () => {
    expect(relativeTime(ago(20_000), now)).toBe('A few seconds ago');
    expect(relativeTime(ago(60_000), now)).toBe('1 minute ago');
    expect(relativeTime(ago(5 * 60_000), now)).toBe('5 minutes ago');
    expect(relativeTime(ago(2 * 3_600_000), now)).toBe('2 hours ago');
    expect(relativeTime('2025-03-03T10:00:00Z', now)).toBe('March 3, 2025');
  });

  it('is empty without a valid time', () => {
    expect(relativeTime(undefined, now)).toBe('');
    expect(relativeTime('not a date', now)).toBe('');
  });
});

describe('initials', () => {
  it('prefers stored initials, else the first two words', () => {
    expect(initialsOf('Ann Lee', 'AL')).toBe('AL');
    expect(initialsOf('ann marie lee')).toBe('AM');
    expect(initialsOf('')).toBe('?');
  });
});

describe('marker stacking', () => {
  it('fans out markers that would overlap', () => {
    const at = stackMarkers(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      2,
      20
    );
    expect(at[0]).toEqual({ x: 0, y: 0 });
    expect(at[1].x).toBeGreaterThanOrEqual(15);
    expect(at[2]).toEqual({ x: 200, y: 200 });
  });
});
