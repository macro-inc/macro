import { describe, expect, it } from 'vitest';
import {
  buildContributionGrid,
  HEATMAP_MAX_CELL,
  HEATMAP_MIN_CELL,
  heatmapGeometry,
} from './contribution-grid';
import { placeholderOverview } from './placeholder-overview';

describe('buildContributionGrid', () => {
  // 2025-09-07 (Sunday) through 2026-09-06: 52 full weeks.
  const year = { from: '2025-09-07', to: '2026-09-06', days: [] };

  it('keeps every column of a whole-week window', () => {
    expect(buildContributionGrid(year).weeks).toHaveLength(52);
  });

  it('keeps partial first and last weeks with the outside days null', () => {
    // Wednesday 2026-08-19 through Sunday 2026-08-30 (to is exclusive).
    const grid = buildContributionGrid({
      from: '2026-08-19',
      to: '2026-08-31',
      days: [
        { date: '2026-08-19', count: 2 },
        { date: '2026-08-23', count: 8 },
        { date: '2026-08-30', count: 5 },
      ],
    });

    expect(grid.weeks).toHaveLength(3);
    expect(grid.weeks[0].map((day) => day?.date ?? null)).toEqual([
      null,
      null,
      null,
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
    ]);
    expect(grid.weeks[2].map((day) => day?.date ?? null)).toEqual([
      '2026-08-30',
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(grid.weeks[2][0]?.count).toBe(5);
  });

  it('shows a window shorter than a week as one partial column', () => {
    const grid = buildContributionGrid({
      from: '2026-08-19',
      to: '2026-08-24',
      days: [{ date: '2026-08-23', count: 8 }],
    });

    expect(grid.weeks).toHaveLength(2);
    expect(grid.weeks[1][0]?.count).toBe(8);
    expect(grid.weeks[1].slice(1)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('gives the placeholder the same columns as the overview it stands in for', () => {
    const placeholder = placeholderOverview(new Date('2026-09-07T12:00:00Z'));
    const real = { ...placeholder, days: [{ date: '2026-09-06', count: 90 }] };
    const placeholderGrid = buildContributionGrid(placeholder);
    const realGrid = buildContributionGrid(real);

    expect(placeholderGrid.weeks).toHaveLength(realGrid.weeks.length);
    expect(realGrid.weeks.at(-1)?.[0]).toMatchObject({
      date: '2026-09-06',
      count: 90,
    });
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

  it('anchors the first week and each first-of-month to a column', () => {
    // Sunday 2026-01-04 opens the window; Feb 1 and Mar 1 are Sundays too.
    const grid = buildContributionGrid({
      from: '2026-01-07',
      to: '2026-03-03',
      days: [],
    });

    expect(
      grid.monthLabels.map(({ label, weekIndex }) => [label, weekIndex])
    ).toEqual([
      ['Jan', 0],
      ['Feb', 4],
      ['Mar', 8],
    ]);
  });

  it('drops the first-week anchor when the next column starts a month', () => {
    // Sunday 2026-02-01 sits in the second column of a window opening 2026-01-28.
    const grid = buildContributionGrid({
      from: '2026-01-28',
      to: '2026-02-20',
      days: [],
    });

    expect(
      grid.monthLabels.map(({ label, weekIndex }) => [label, weekIndex])
    ).toEqual([['Feb', 1]]);
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

describe('heatmapGeometry', () => {
  const columns = 53;

  it('takes the full size before measurement', () => {
    expect(heatmapGeometry(null, columns)).toEqual({
      cell: HEATMAP_MAX_CELL,
      gap: 3,
      width: 53 * 12 + 52 * 3,
      height: 7 * 12 + 6 * 3,
      overflows: false,
    });
  });

  it('caps the cell at the full size in a wide pane', () => {
    const wide = heatmapGeometry(1000, columns);
    expect(wide).toMatchObject({ cell: 12, gap: 3, overflows: false });
    expect(wide.width).toBe(792);
    expect(wide.height).toBe(102);
  });

  it('shrinks the cell at the wide gap while ten pixels still fit', () => {
    // 53 * 11 + 52 * 3 = 739.
    expect(heatmapGeometry(740, columns)).toMatchObject({
      cell: 11,
      gap: 3,
      width: 739,
      overflows: false,
    });
  });

  it('tightens the gap once the cell would fall under ten pixels', () => {
    // At gap 3, 640 fits a 9px cell; at gap 2 it fits 10, capped to 9: 53 * 9 + 52 * 2 = 581.
    expect(heatmapGeometry(640, columns)).toMatchObject({
      cell: 9,
      gap: 2,
      width: 581,
      height: 75,
      overflows: false,
    });
  });

  it('stops at the minimum cell and overflows below it', () => {
    // 53 * 8 + 52 * 2 = 528.
    expect(heatmapGeometry(528, columns)).toMatchObject({
      cell: HEATMAP_MIN_CELL,
      gap: 2,
      width: 528,
      overflows: false,
    });
    expect(heatmapGeometry(336, columns)).toMatchObject({
      cell: HEATMAP_MIN_CELL,
      gap: 2,
      width: 528,
      height: 68,
      overflows: true,
    });
  });

  it('has no width for an empty grid', () => {
    expect(heatmapGeometry(300, 0)).toMatchObject({
      cell: HEATMAP_MAX_CELL,
      width: 0,
      overflows: false,
    });
  });
});
