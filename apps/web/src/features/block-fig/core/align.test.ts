import { describe, expect, it } from 'vitest';
import { alignOffset } from './align';

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
