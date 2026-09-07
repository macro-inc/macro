import { describe, expect, it } from 'vitest';
import {
  buildContributionGrid,
  HEATMAP_CELL_PX,
  HEATMAP_GAP_PX,
  HEATMAP_HEIGHT_PX,
  weeksThatFit,
} from './contribution-grid';

describe('buildContributionGrid', () => {
  describe('maxWeeks', () => {
    // 2025-09-07 (Sunday) through 2026-09-06: 52 full weeks.
    const year = { from: '2025-09-07', to: '2026-09-06', days: [] };

    it('keeps every column when unset', () => {
      expect(buildContributionGrid(year).weeks).toHaveLength(52);
    });

    it('keeps the trailing columns and re-anchors the first visible month', () => {
      const grid = buildContributionGrid(year, { maxWeeks: 20 });
      expect(grid.weeks).toHaveLength(20);
      expect(grid.weeks[0]?.[0]?.date).toBe('2026-04-19');
      expect(grid.weeks[19]?.[6]?.date).toBe('2026-09-05');
      expect(
        grid.monthLabels.map(({ label, weekIndex }) => [label, weekIndex])
      ).toEqual([
        ['Apr', 0],
        ['May', 1],
        ['Jun', 6],
        ['Jul', 10],
        ['Aug', 14],
        ['Sep', 19],
      ]);
    });

    it('is a no-op when more columns fit than exist', () => {
      expect(buildContributionGrid(year, { maxWeeks: 60 }).weeks).toHaveLength(
        52
      );
    });

    it('treats zero, negative and fractional counts as whole columns', () => {
      expect(buildContributionGrid(year, { maxWeeks: 0 }).weeks).toEqual([]);
      expect(buildContributionGrid(year, { maxWeeks: -3 }).weeks).toEqual([]);
      expect(buildContributionGrid(year, { maxWeeks: 2.9 }).weeks).toHaveLength(
        2
      );
    });
  });

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

describe('weeksThatFit', () => {
  const column = HEATMAP_CELL_PX + HEATMAP_GAP_PX;

  it('counts whole columns, sharing the trailing gap', () => {
    expect(weeksThatFit(HEATMAP_CELL_PX)).toBe(1);
    expect(weeksThatFit(HEATMAP_CELL_PX - 1)).toBe(0);
    expect(weeksThatFit(20 * column - HEATMAP_GAP_PX)).toBe(20);
    expect(weeksThatFit(20 * column - HEATMAP_GAP_PX - 1)).toBe(19);
    expect(weeksThatFit(1000)).toBeGreaterThanOrEqual(53);
  });

  it('fits nothing before measurement or when hidden', () => {
    expect(weeksThatFit(null)).toBe(0);
    expect(weeksThatFit(0)).toBe(0);
  });

  it('exports a height equal to seven cells and six gaps', () => {
    expect(HEATMAP_HEIGHT_PX).toBe(102);
  });
});
