import { describe, expect, it } from 'vitest';
import { gridLines, rulerTicks } from './rulers';
import { snapMove } from './snap';

describe('rulers and grid', () => {
  it('measures from the center in inches', () => {
    // A 10" slide at 1 px per point: eighths are 9 px apart.
    const ticks = rulerTicks(720, 1);
    expect(ticks.find((t) => t.at === 360)).toEqual({
      at: 360,
      weight: 2,
      label: 0,
    });
    expect(ticks.find((t) => t.at === 360 + 72)?.label).toBe(1);
    expect(ticks.find((t) => t.at === 360 - 144)?.label).toBe(2);
    expect(ticks.find((t) => t.at === 360 + 36)?.weight).toBe(1);
    expect(ticks.find((t) => t.at === 360 + 9)?.weight).toBe(0);
    expect(ticks).toHaveLength(81);
    // Zoomed out, only quarters and up remain.
    expect(rulerTicks(720, 0.3).every((t) => (t.at - 360) % 18 === 0)).toBe(
      true
    );
  });

  it('thins gridlines to stay readable', () => {
    expect(gridLines(60, 6, 2)).toEqual([6, 12, 18, 24, 30, 36, 42, 48, 54]);
    // 6 pt at 0.5 px per point is 3 px: every third line remains.
    expect(gridLines(60, 6, 0.5)).toEqual([18, 36, 54]);
    expect(gridLines(60, 0, 1)).toEqual([]);
  });

  it('snaps to the grid where no smart guide is near', () => {
    const slide = { w: 960, h: 540 };
    const moving = { x: 101, y: 198.5, w: 50, h: 40 };
    // Smart guides off: straight to the grid.
    expect(
      snapMove(moving, [], slide, 4, { grid: 9, guides: false })
    ).toMatchObject({ dx: -2, dy: -0.5 });
    // A shape edge within reach wins over the grid on that axis.
    const other = { x: 151, y: 400, w: 100, h: 100 };
    const snap = snapMove({ ...moving, x: 99 }, [other], slide, 4, {
      grid: 9,
    });
    expect(snap.dx).toBe(2);
    expect(snap.dy).toBe(-0.5);
    // Without a grid nothing moves when no guide is near.
    expect(snapMove(moving, [], slide, 1)).toMatchObject({ dx: 0, dy: 0 });
  });
});
