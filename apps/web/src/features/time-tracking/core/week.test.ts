import { describe, expect, it } from 'vitest';
import { readRange, weekAt, weekDays, weekRows } from './week';

describe('weekAt', () => {
  it('steps whole weeks from the one holding today', () => {
    expect(weekAt('2026-11-24', 1, 0)).toEqual({
      from: '2026-11-23',
      to: '2026-11-29',
    });
    expect(weekAt('2026-11-24', 1, -1)).toEqual({
      from: '2026-11-16',
      to: '2026-11-22',
    });
    expect(weekAt('2026-11-24', 0, 1)).toEqual({
      from: '2026-11-29',
      to: '2026-12-05',
    });
  });
});

describe('weekDays', () => {
  it('lists the seven days, or the weekdays when weekends are hidden', () => {
    const week = weekAt('2026-11-24', 0, 0);
    expect(weekDays(week, true)).toEqual([
      '2026-11-22',
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
    ]);
    expect(weekDays(week, false)).toEqual([
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
    ]);
  });
});

describe('weekRows', () => {
  it('keeps the server order and adds tasks with no time yet once', () => {
    const day = (date: string, minutes: number) => ({
      key: { date },
      minutes,
    });
    const rows = weekRows(
      [
        {
          key: 'a',
          minutes: 90,
          rows: [day('2026-11-23', 60), day('2026-11-24', 30)],
        },
        { key: 'b', minutes: 15, rows: [day('2026-11-25', 15)] },
      ],
      ['b', 'c'],
      (left, right) => left === right
    );
    expect(rows).toEqual([
      { key: 'a', minutes: 90, byDay: { '2026-11-23': 60, '2026-11-24': 30 } },
      { key: 'b', minutes: 15, byDay: { '2026-11-25': 15 } },
      { key: 'c', minutes: 0, byDay: {} },
    ]);
  });
});

describe('readRange', () => {
  it('reads Monday to Friday with weekends hidden, for either week start', () => {
    expect(readRange(weekAt('2026-11-24', 0, 0), false)).toEqual({
      from: '2026-11-23',
      to: '2026-11-27',
    });
    expect(readRange(weekAt('2026-11-24', 1, 0), false)).toEqual({
      from: '2026-11-23',
      to: '2026-11-27',
    });
    expect(readRange(weekAt('2026-11-24', 0, 0), true)).toEqual({
      from: '2026-11-22',
      to: '2026-11-28',
    });
  });
});
