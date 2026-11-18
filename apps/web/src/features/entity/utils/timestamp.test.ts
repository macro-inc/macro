import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatCompactRelativeTimestamp, formatTimestamp } from './timestamp';

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

describe('formatTimestamp system timezone', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('keeps invalid input from throwing during row rendering', () => {
    expect(formatTimestamp('not a date')).toBe('Invalid Date');
  });

  it('updates time, calendar day and year after system timezone changes', () => {
    const today = '2026-09-07T11:00:00Z';
    const sameYear = '2026-07-04T01:00:00Z';
    const oldYear = '2025-01-01T01:00:00Z';
    vi.stubEnv('TZ', 'UTC');
    expect([today, sameYear, oldYear].map(formatTimestamp)).toEqual([
      '11:00 AM',
      'Jul 4',
      '1/1/25',
    ]);
    vi.stubEnv('TZ', 'America/New_York');
    expect([today, sameYear, oldYear].map(formatTimestamp)).toEqual([
      '7:00 AM',
      'Jul 3',
      '12/31/24',
    ]);
    vi.stubEnv('TZ', 'UTC');
    expect([today, sameYear, oldYear].map(formatTimestamp)).toEqual([
      '11:00 AM',
      'Jul 4',
      '1/1/25',
    ]);
  });
});
