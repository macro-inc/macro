import { describe, expect, it } from 'vitest';
import { periodStart, spendBars, spendTotal } from './spend';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('spendBars', () => {
  it('fills the days without spend with zero, oldest first', () => {
    const bars = spendBars(
      'day',
      '2026-11-10T00:00:00Z',
      '2026-11-13T00:00:00Z',
      [
        { start: '2026-11-12T00:00:00Z', costUsd: 2.5 },
        { start: '2026-11-10T00:00:00Z', costUsd: 1 },
      ]
    );
    expect(bars).toEqual([
      { start: day('2026-11-10'), costUsd: 1 },
      { start: day('2026-11-11'), costUsd: 0 },
      { start: day('2026-11-12'), costUsd: 2.5 },
    ]);
    expect(spendTotal(bars)).toBe(3.5);
  });

  it('starts weeks on Monday and months and years on their first day', () => {
    // 2026-11-13 is a Friday.
    expect(periodStart('week', new Date('2026-11-13T15:00:00Z'))).toEqual(
      day('2026-11-09')
    );
    expect(periodStart('week', new Date('2026-11-15T23:00:00Z'))).toEqual(
      day('2026-11-09')
    );
    expect(periodStart('month', new Date('2026-11-13T15:00:00Z'))).toEqual(
      day('2026-11-01')
    );
    expect(periodStart('year', new Date('2026-11-13T15:00:00Z'))).toEqual(
      day('2026-01-01')
    );
  });

  it('covers a month window across a year end', () => {
    const bars = spendBars(
      'month',
      '2025-12-01T00:00:00Z',
      '2026-02-01T00:00:00Z',
      [{ start: '2026-01-01T00:00:00Z', costUsd: 4 }]
    );
    expect(bars.map((bar) => [bar.start.toISOString(), bar.costUsd])).toEqual([
      ['2025-12-01T00:00:00.000Z', 0],
      ['2026-01-01T00:00:00.000Z', 4],
    ]);
  });

  it('draws nothing for a window it cannot read', () => {
    expect(spendBars('day', 'not a date', '2026-11-13T00:00:00Z', [])).toEqual(
      []
    );
  });
});
