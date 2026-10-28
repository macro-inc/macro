import { describe, expect, it } from 'vitest';
import { snapMove } from './snap';

const SLIDE = { w: 960, h: 540 };

describe('smart guides', () => {
  it('snaps a shape center to the slide center', () => {
    const snap = snapMove({ x: 378, y: 100, w: 200, h: 50 }, [], SLIDE, 4);
    expect(snap.dx).toBe(2);
    expect(snap.guides.xs).toContain(480);
  });

  it('snaps edges to another shape and reports the guide', () => {
    const other = { x: 100, y: 300, w: 120, h: 60 };
    const snap = snapMove({ x: 102.5, y: 10, w: 50, h: 50 }, [other], SLIDE, 4);
    expect(snap.dx).toBe(-2.5);
    expect(snap.guides.xs).toEqual([100]);
    expect(snap.dy).toBe(0);
    expect(snap.guides.ys).toEqual([]);
  });

  it('leaves far-off shapes alone', () => {
    const snap = snapMove({ x: 333, y: 222, w: 10, h: 10 }, [], SLIDE, 4);
    expect(snap).toEqual({ dx: 0, dy: 0, guides: { xs: [], ys: [] } });
  });
});
