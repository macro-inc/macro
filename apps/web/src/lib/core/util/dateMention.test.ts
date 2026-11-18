import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRelativeDay, parseMentionDate } from './dateParser';

describe('parseMentionDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Thursday afternoon, local time.
    vi.setSystemTime(new Date(2026, 8, 24, 16, 3));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads a bare date as that local day, so today stays today', () => {
    const date = parseMentionDate('2026-09-24');

    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([
      2026, 8, 24,
    ]);
    expect(formatRelativeDay(date)).toBe('Today');
  });

  it('reads a timestamp as the instant it names', () => {
    expect(parseMentionDate('2026-09-24T16:03:00-04:00').toISOString()).toBe(
      '2026-09-24T20:03:00.000Z'
    );
  });

  it('keeps a year before 100 as written', () => {
    expect(parseMentionDate('0025-03-01').getFullYear()).toBe(25);
  });

  it('keeps an invalid value invalid', () => {
    expect(Number.isNaN(parseMentionDate('2026-02-31').getTime())).toBe(true);
    expect(Number.isNaN(parseMentionDate('soon').getTime())).toBe(true);
  });
});
