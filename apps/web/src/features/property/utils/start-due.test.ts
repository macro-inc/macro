import { describe, expect, it } from 'vitest';
import { formatStartDue, pickDay, startDueDays } from './start-due';

const NOW = new Date(2026, 10, 20);

describe('formatStartDue', () => {
  it('reads as a range within the current year', () => {
    expect(
      formatStartDue(
        { start: new Date(2026, 10, 23), due: new Date(2026, 10, 27) },
        NOW
      )
    ).toBe('Nov 23 → Nov 27');
  });

  it('names the year once when it is not the current one', () => {
    expect(
      formatStartDue(
        { start: new Date(2027, 0, 4), due: new Date(2027, 0, 8) },
        NOW
      )
    ).toBe('Jan 4 → Jan 8, 2027');
  });

  it('names both years when the range crosses one', () => {
    expect(
      formatStartDue(
        { start: new Date(2026, 11, 28), due: new Date(2027, 0, 3) },
        NOW
      )
    ).toBe('Dec 28, 2026 → Jan 3, 2027');
  });

  it('leaves the end open without a due date', () => {
    expect(
      formatStartDue({ start: new Date(2026, 10, 23), due: null }, NOW)
    ).toBe('Nov 23 →');
  });

  it('has no range without a start', () => {
    expect(
      formatStartDue({ start: null, due: new Date(2026, 10, 27) }, NOW)
    ).toBeUndefined();
  });
});

describe('startDueDays', () => {
  it('counts both ends', () => {
    expect(startDueDays(new Date(2026, 10, 23), new Date(2026, 10, 27))).toBe(
      5
    );
    expect(startDueDays(new Date(2026, 10, 23), new Date(2026, 10, 23))).toBe(
      1
    );
  });

  it('counts calendar days across a daylight saving change', () => {
    expect(startDueDays(new Date(2026, 2, 7), new Date(2026, 2, 9))).toBe(3);
  });
});

describe('pickDay', () => {
  const range = { start: new Date(2026, 10, 23), due: new Date(2026, 10, 27) };

  it('sets the field that is picked', () => {
    expect(pickDay(range, 'due', new Date(2026, 10, 30))).toEqual({
      dates: { start: range.start, due: new Date(2026, 10, 30) },
      changed: 'due',
    });
    expect(pickDay(range, 'start', new Date(2026, 10, 25))).toEqual({
      dates: { start: new Date(2026, 10, 25), due: range.due },
      changed: 'start',
    });
  });

  it('makes a due day before the start the new start', () => {
    expect(pickDay(range, 'due', new Date(2026, 10, 20))).toEqual({
      dates: { start: new Date(2026, 10, 20), due: range.due },
      changed: 'start',
    });
  });

  it('makes a start day after the due date the new due date', () => {
    expect(pickDay(range, 'start', new Date(2026, 11, 1))).toEqual({
      dates: { start: range.start, due: new Date(2026, 11, 1) },
      changed: 'due',
    });
  });

  it('lets either end be set alone', () => {
    expect(pickDay({ start: null, due: null }, 'start', range.start)).toEqual({
      dates: { start: range.start, due: null },
      changed: 'start',
    });
    expect(pickDay({ start: null, due: null }, 'due', range.due)).toEqual({
      dates: { start: null, due: range.due },
      changed: 'due',
    });
  });
});
