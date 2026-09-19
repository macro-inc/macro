import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatCompactRelativeTimestamp } from './timestamp';

const NOW = new Date('2026-09-07T12:00:00.000Z');

describe('formatCompactRelativeTimestamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['2026-09-07T11:59:30.000Z', 'now'],
    ['2026-09-07T12:00:30.000Z', 'now'],
    ['2026-09-07T11:55:00.000Z', '5m'],
    ['2026-09-07T11:00:01.000Z', '59m'],
    ['2026-09-06T19:00:00.000Z', '17h'],
    ['2026-09-06T12:00:00.000Z', '1d'],
    ['2026-09-01T12:00:00.000Z', '6d'],
    ['2026-08-30T12:00:00.000Z', '1w'],
    ['2026-08-17T12:00:00.000Z', '3w'],
    ['2026-08-01T12:00:00.000Z', '1mo'],
    ['2025-10-07T12:00:00.000Z', '11mo'],
    ['2024-09-07T12:00:00.000Z', '2y'],
  ])('%s -> %s', (value, expected) => {
    expect(formatCompactRelativeTimestamp(value)).toBe(expected);
  });

  it('returns an unparseable value unchanged', () => {
    expect(formatCompactRelativeTimestamp('not a date')).toBe('not a date');
  });
});
