import { describe, expect, it } from 'vitest';
import { alignOffset, distributeOffsets } from './align';

const box = { x: 10, y: 20, w: 30, h: 40 };
const to = { x: 0, y: 0, w: 100, h: 200 };

describe('alignment', () => {
  it('aligns edges and centers within a rectangle', () => {
    expect(alignOffset(box, to, 'left')).toEqual({ dx: -10, dy: 0 });
    expect(alignOffset(box, to, 'center')).toEqual({ dx: 25, dy: 0 });
    expect(alignOffset(box, to, 'right')).toEqual({ dx: 60, dy: 0 });
    expect(alignOffset(box, to, 'top')).toEqual({ dx: 0, dy: -20 });
    expect(alignOffset(box, to, 'middle')).toEqual({ dx: 0, dy: 60 });
    expect(alignOffset(box, to, 'bottom')).toEqual({ dx: 0, dy: 140 });
  });
});

describe('distributing', () => {
  const at = (id: string, x: number, w: number) => ({
    id,
    bounds: { x, y: 0, w, h: 10 },
  });

  it('spaces layers evenly between the outermost two', () => {
    // Spans 0–100 with 60 of width: 20 between each.
    expect(
      distributeOffsets(
        [at('c', 90, 10), at('a', 0, 20), at('b', 25, 30)],
        'horizontal'
      )
    ).toEqual([
      { id: 'a', dx: 0, dy: 0 },
      { id: 'b', dx: 15, dy: 0 },
      { id: 'c', dx: 0, dy: 0 },
    ]);
  });

  it('needs three layers', () => {
    expect(
      distributeOffsets([at('a', 0, 10), at('b', 50, 10)], 'vertical')
    ).toEqual([]);
  });
});
