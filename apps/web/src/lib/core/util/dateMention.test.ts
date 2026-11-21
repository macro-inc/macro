import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatMentionLabel,
  formatRelativeDay,
  parseMentionDate,
} from './dateParser';

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

describe('formatMentionLabel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Thursday afternoon, local time.
    vi.setSystemTime(new Date(2026, 8, 24, 16, 3));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the day and time of a moment its label names', () => {
    const today = new Date(2026, 8, 24, 15, 15).toISOString();
    const tomorrow = new Date(2026, 8, 25, 9, 0).toISOString();

    expect(formatMentionLabel(today, '3:15 PM')).toBe('Today, 3:15 PM');
    expect(formatMentionLabel(tomorrow, '9:00 AM')).toBe('Tomorrow, 9:00 AM');
  });

  it('reads a 24-hour label as a time too', () => {
    const today = new Date(2026, 8, 24, 15, 15).toISOString();

    expect(formatMentionLabel(today, 'Sep 24 15:15')).toBe('Today, 3:15 PM');
  });

  it('keeps a day picked in the editor a day', () => {
    const midnight = new Date(2026, 8, 24).toISOString();

    expect(formatMentionLabel(midnight, 'Today')).toBe('Today');
  });

  it('keeps a day picked at another zone’s midnight a day', () => {
    expect(
      formatMentionLabel('2026-09-25T04:00:00.000Z', 'Tomorrow')
    ).not.toMatch(/\d:\d\d/);
  });

  it('keeps missing labels on the day-only path', () => {
    const today = new Date(2026, 8, 24, 15, 15).toISOString();

    expect(formatMentionLabel(today, null)).toBe('Today');
    expect(formatMentionLabel(today, undefined)).toBe('Today');
  });

  it('preserves the parsed day fallback for null and omitted dates', () => {
    expect(formatMentionLabel(null, '3:15 PM')).toBe(
      formatRelativeDay(parseMentionDate(null))
    );
    expect(formatMentionLabel(undefined, '3:15 PM')).toBe(
      formatRelativeDay(parseMentionDate(undefined))
    );
  });

  it('keeps a bare day a day whatever its label says', () => {
    expect(formatMentionLabel('2026-09-24', '3:15 PM')).toBe('Today');
  });
});
