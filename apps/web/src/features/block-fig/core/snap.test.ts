import { describe, expect, it } from 'vitest';
import { snapMove } from './snap';

const box = { x: 0, y: 0, w: 10, h: 10 };
const other = { x: 100, y: 50, w: 20, h: 20 };

describe('smart guides', () => {
  it('snaps an edge to a nearby edge', () => {
    // Moving right by 88 puts the right edge at 98, 2 from the other's left.
    const r = snapMove(box, 88, 0, [other], 4);
    expect(r.dx).toBe(90);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([{ axis: 'x', at: 100, from: 0, to: 70 }]);
  });

  it('snaps centers', () => {
    // Center y of other is 60; moving down 54 puts ours at 59.
    const r = snapMove(box, 0, 54, [other], 4);
    expect(r.dy).toBe(55);
    expect(r.guides[0]).toMatchObject({ axis: 'y', at: 60 });
  });

  it('leaves far moves alone', () => {
    const r = snapMove(box, 30, 30, [other], 4);
    expect(r).toEqual({ dx: 30, dy: 30, guides: [] });
  });

  it('prefers the closest stop', () => {
    const r = snapMove(box, 97, 0, [other, { x: 98, y: 0, w: 5, h: 5 }], 4);
    // Left edge at 97: 1 from 98 beats right edge's 3 from 110? (107→110).
    expect(r.dx).toBe(98);
  });
});
