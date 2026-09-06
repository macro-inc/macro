import { describe, expect, it } from 'vitest';
import { buildContributionGrid } from './contribution-grid';

describe('buildContributionGrid', () => {
  it('omits leading and trailing weeks that are not a full Sunday–Saturday', () => {
    const grid = buildContributionGrid({
      from: '2026-08-19',
      to: '2026-08-31',
      days: [
        { date: '2026-08-19', count: 2 },
        { date: '2026-08-23', count: 8 },
      ],
    });

    expect(grid.weeks).toHaveLength(1);
    expect(grid.weeks[0].map((day) => day?.date)).toEqual([
      '2026-08-23',
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
    ]);
  });

  it('returns no columns when the window contains no full week', () => {
    const grid = buildContributionGrid({
      from: '2026-08-19',
      to: '2026-08-24',
      days: [
        { date: '2026-08-19', count: 2 },
        { date: '2026-08-23', count: 8 },
      ],
    });

    expect(grid.weeks).toEqual([]);
    expect(grid.monthLabels).toEqual([]);
  });

  it('fills missing API dates with zero and derives relative intensity', () => {
    const grid = buildContributionGrid({
      from: '2026-08-16',
      to: '2026-08-23',
      days: [
        { date: '2026-08-17', count: 1 },
        { date: '2026-08-20', count: 4 },
      ],
    });

    expect(grid.weeks[0].map((day) => day?.count)).toEqual([
      0, 1, 0, 0, 4, 0, 0,
    ]);
    expect(grid.weeks[0].map((day) => day?.intensity)).toEqual([
      0, 1, 0, 0, 4, 0, 0,
    ]);
  });

  it('anchors the current month and each later month to a week column', () => {
    const grid = buildContributionGrid({
      from: '2026-01-30',
      to: '2026-03-03',
      days: [],
    });

    expect(
      grid.monthLabels.map(({ label, weekIndex }) => [label, weekIndex])
    ).toEqual([['Feb', 0]]);
  });

  it('returns no columns for an invalid or empty window', () => {
    expect(
      buildContributionGrid({
        from: '2026-08-21',
        to: '2026-08-21',
        days: [],
      })
    ).toEqual({ weeks: [], monthLabels: [] });
  });
});
