import { afterEach, describe, expect, it, vi } from 'vitest';
import { homeClock, homeDateBucket } from './home-date-buckets';

const evening = new Date(2026, 8, 14, 20, 0);
const todayAt = (hour: number, minute = 0) =>
  new Date(2026, 8, 14, hour, minute);

describe('Home time sections', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps clock-skewed timestamps in the newest section', () => {
    expect(homeDateBucket(new Date(evening.getTime() + 1), evening).key).toBe(
      'last-few-minutes'
    );
    expect(homeDateBucket(todayAt(21), evening).key).toBe('last-few-minutes');
  });
  it('includes the current time in Last few minutes', () => {
    expect(homeDateBucket(evening, evening).key).toBe('last-few-minutes');
  });
  it('uses non-overlapping fine-grained sections throughout the day', () => {
    expect(homeDateBucket(todayAt(19, 58), evening).label).toBe(
      'Last few minutes'
    );
    expect(homeDateBucket(todayAt(19, 55), evening).label).toBe('Last hour');
    expect(homeDateBucket(todayAt(19), evening).label).toBe('This evening');
    expect(homeDateBucket(todayAt(15), evening).label).toBe('This afternoon');
    expect(homeDateBucket(todayAt(9), evening).label).toBe('This morning');
    expect(homeDateBucket(todayAt(3), evening).label).toBe('Earlier today');
  });
  it('moves an unchanged item between groups as the clock advances', () => {
    const item = todayAt(9);
    expect(homeDateBucket(item, todayAt(9, 3)).key).toBe('last-few-minutes');
    expect(homeDateBucket(item, todayAt(9, 15)).key).toBe('last-hour');
    expect(homeDateBucket(item, todayAt(10)).key).toBe('this-morning');
  });
  it('keeps rolling sections across midnight before moving to Yesterday', () => {
    expect(
      homeDateBucket(todayAt(23, 59), new Date(2026, 8, 15, 0, 1)).key
    ).toBe('last-few-minutes');
    expect(
      homeDateBucket(todayAt(23, 59), new Date(2026, 8, 15, 0, 10)).key
    ).toBe('last-hour');
    expect(homeDateBucket(todayAt(23, 59), new Date(2026, 8, 15, 1)).key).toBe(
      'yesterday'
    );
  });
  it('preserves older sections and handles absent or invalid timestamps', () => {
    expect(homeDateBucket(new Date(2026, 8, 13, 10), evening).key).toBe(
      'yesterday'
    );
    expect(homeDateBucket(new Date(2026, 8, 11, 10), evening).key).toBe(
      'last-7-days'
    );
    expect(homeDateBucket(undefined, evening).key).toBe('older');
    expect(homeDateBucket('bad date', evening).key).toBe('older');
    expect(homeDateBucket(null, evening).key).toBe('older');
    expect(homeDateBucket(new Date(NaN), evening).key).toBe('older');
  });

  it('uses the same clock after a refresh within the same minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 14, 20, 0, 1));
    const before = homeClock();
    vi.setSystemTime(new Date(2026, 8, 14, 20, 0, 59));
    expect(homeClock()).toBe(before);
    vi.setSystemTime(new Date(2026, 8, 14, 20, 1));
    expect(homeClock()).toBe(before + 60_000);
  });

  it('keeps calendar sections stable at month and year boundaries', () => {
    const reference = new Date(2027, 0, 2, 12);
    expect(homeDateBucket(new Date(2027, 0, 1, 10), reference).key).toBe(
      'yesterday'
    );
    expect(homeDateBucket(new Date(2026, 11, 31, 10), reference).key).toBe(
      'last-7-days'
    );
    expect(homeDateBucket(new Date(2026, 11, 1), reference).key).toBe(
      'last-month'
    );
    expect(homeDateBucket(new Date(2026, 10, 30), reference).key).toBe('older');
  });
});
