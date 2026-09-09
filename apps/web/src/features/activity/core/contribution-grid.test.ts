import { describe, expect, it } from 'vitest';
import {
  buildContributionGrid,
  HEATMAP_MAX_CELL,
  HEATMAP_MIN_CELL,
  heatmapGeometry,
  scrollLeftAtWeeksFromEnd,
  weeksFromEnd,
} from './contribution-grid';

describe('buildContributionGrid', () => {
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
      columnGap: 3,
      width: 53 * 14 + 52 * 3,
      height: 7 * 14 + 6 * 3,
      overflows: false,
    });
  });

  it('caps the cell in a wide pane and opens the seams so the year spans it', () => {
    const wide = heatmapGeometry(1002, columns);
    expect(wide).toMatchObject({ cell: 14, gap: 3, overflows: false });
    // (1002 - 53 * 14) / 52 = 5px between columns; rows keep the 3px gap.
    expect(wide.columnGap).toBe(5);
    expect(wide.width).toBe(1002);
    expect(wide.height).toBe(7 * 14 + 6 * 3);
  });

  it('tightens the gap once the cell would fall under ten pixels', () => {
    // At gap 3, 640 fits a 9px cell; at gap 2 it fits 10, capped to 9.
    expect(heatmapGeometry(640, columns)).toMatchObject({
      cell: 9,
      gap: 2,
      height: 75,
      overflows: false,
    });
  });

  it('stops at the minimum cell and overflows below it', () => {
    // 53 * 8 + 52 * 2 = 528.
    expect(heatmapGeometry(528, columns)).toMatchObject({
      cell: HEATMAP_MIN_CELL,
      gap: 2,
      columnGap: 2,
      width: 528,
      overflows: false,
    });
    // Overflowing keeps the natural seams: the area scrolls instead.
    expect(heatmapGeometry(336, columns)).toMatchObject({
      cell: HEATMAP_MIN_CELL,
      gap: 2,
      columnGap: 2,
      width: 528,
      height: 68,
      overflows: true,
    });
  });
});

describe('week-anchored scroll position', () => {
  // 53 columns at 8px cells / 2px gaps on a 300px-wide phone area.
  const phone = heatmapGeometry(300, 53);
  const area = { scrollWidth: phone.width, clientWidth: 300 };

  it('reads the newest week at the right edge as zero', () => {
    const atEnd = area.scrollWidth - area.clientWidth;
    expect(weeksFromEnd({ ...area, scrollLeft: atEnd }, phone)).toBe(0);
    // Over-scroll past the end still reads as the newest week.
    expect(weeksFromEnd({ ...area, scrollLeft: atEnd + 40 }, phone)).toBe(0);
  });

  it('opens on the newest week at zero and clamps at the oldest', () => {
    expect(scrollLeftAtWeeksFromEnd(0, area, phone)).toBe(
      area.scrollWidth - area.clientWidth
    );
    expect(scrollLeftAtWeeksFromEnd(1000, area, phone)).toBe(0);
  });

  it('lands on the same weeks after the pane changes size', () => {
    const pitch = phone.cell + phone.columnGap;
    const panned = {
      ...area,
      scrollLeft: area.scrollWidth - area.clientWidth - 8 * pitch,
    };
    const weeks = weeksFromEnd(panned, phone);
    expect(weeks).toBe(8);

    const wider = heatmapGeometry(380, 53);
    expect(wider.overflows).toBe(true);
    const after = { scrollWidth: wider.width, clientWidth: 380 };
    const restored = scrollLeftAtWeeksFromEnd(weeks, after, wider);
    expect(weeksFromEnd({ ...after, scrollLeft: restored }, wider)).toBeCloseTo(
      8
    );
  });
});
