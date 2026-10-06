import { describe, expect, it } from 'vitest';
import {
  anchorsOf,
  closesPen,
  isSmooth,
  moveAnchor,
  moveHandle,
  type PathData,
  penHandle,
  penPath,
  transformPath,
} from './path';

const p = (x: number, y: number) => ({ x, y });

/** A closed curve: two cubic halves back to the start, then `close`. */
const lens: PathData = {
  segs: [
    { type: 'move', p: p(0, 0) },
    { type: 'cubic', c1: p(0, -10), c2: p(20, -10), p: p(20, 0) },
    { type: 'cubic', c1: p(20, 10), c2: p(0, 10), p: p(0, 0) },
    { type: 'close' },
  ],
};

describe('anchorsOf', () => {
  it('lists corners of an open polyline without handles', () => {
    const anchors = anchorsOf({
      segs: [
        { type: 'move', p: p(0, 0) },
        { type: 'line', p: p(10, 0) },
        { type: 'line', p: p(10, 10) },
      ],
    });
    expect(anchors.map((a) => a.point)).toEqual([p(0, 0), p(10, 0), p(10, 10)]);
    expect(anchors.every((a) => !a.handleIn && !a.handleOut)).toBe(true);
  });

  it('merges a closed curve’s return into its first anchor', () => {
    const anchors = anchorsOf(lens);
    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toMatchObject({
      seg: 0,
      twin: 2,
      handleIn: p(0, 10),
      inSeg: 2,
      handleOut: p(0, -10),
      outSeg: 1,
    });
    expect(anchors[1]).toMatchObject({
      seg: 1,
      handleIn: p(20, -10),
      handleOut: p(20, 10),
    });
  });

  it('keeps separate subpaths apart', () => {
    const anchors = anchorsOf({
      segs: [
        { type: 'move', p: p(0, 0) },
        { type: 'line', p: p(1, 0) },
        { type: 'close' },
        { type: 'move', p: p(5, 5) },
        { type: 'line', p: p(6, 5) },
      ],
    });
    expect(anchors.map((a) => a.seg)).toEqual([0, 1, 3, 4]);
  });
});

describe('editing points', () => {
  it('moves an anchor with its handles, and its twin', () => {
    const [first] = anchorsOf(lens);
    const moved = moveAnchor(lens, first, p(5, 5));
    expect(moved.segs[0]).toEqual({ type: 'move', p: p(5, 5) });
    expect(moved.segs[1]).toMatchObject({ c1: p(5, -5), c2: p(20, -10) });
    expect(moved.segs[2]).toMatchObject({ c2: p(5, 15), p: p(5, 5) });
  });

  it('keeps a smooth point smooth unless broken', () => {
    const [, right] = anchorsOf(lens);
    expect(
      isSmooth(
        right.point,
        right.handleIn ?? p(0, 0),
        right.handleOut ?? p(0, 0)
      )
    ).toBe(true);
    const turned = moveHandle(lens, right, 'out', p(30, 0), false);
    // The other handle swings opposite, keeping its 10 pt length.
    expect(turned.segs[1]).toMatchObject({ c2: p(10, 0) });
    expect(turned.segs[2]).toMatchObject({ c1: p(30, 0) });
    const broken = moveHandle(lens, right, 'out', p(30, 0), true);
    expect(broken.segs[1]).toMatchObject({ c2: p(20, -10) });
  });

  it('maps a path through a matrix', () => {
    const moved = transformPath(lens, [2, 0, 0, 2, 1, 1]);
    expect(moved.segs[1]).toEqual({
      type: 'cubic',
      c1: p(1, -19),
      c2: p(41, -19),
      p: p(41, 1),
    });
  });
});

describe('the pen', () => {
  it('draws lines between corners and closes back', () => {
    const path = penPath(
      [
        { p: p(0, 0), out: null },
        { p: p(10, 0), out: null },
        { p: p(10, 10), out: null },
      ],
      true
    );
    expect(path.segs).toEqual([
      { type: 'move', p: p(0, 0) },
      { type: 'line', p: p(10, 0) },
      { type: 'line', p: p(10, 10) },
      { type: 'close' },
    ]);
  });

  it('curves through dragged points with mirrored handles', () => {
    const path = penPath(
      [
        { p: p(0, 0), out: p(5, -5) },
        { p: p(20, 0), out: p(25, 5) },
      ],
      false
    );
    expect(path.segs[1]).toEqual({
      type: 'cubic',
      c1: p(5, -5),
      c2: p(15, -5),
      p: p(20, 0),
    });
  });

  it('closes on the first point and ignores short drags', () => {
    const points = [
      { p: p(0, 0), out: null },
      { p: p(10, 0), out: null },
    ];
    expect(closesPen(points, p(1, 1), 4)).toBe(true);
    expect(closesPen(points.slice(0, 1), p(0, 0), 4)).toBe(false);
    expect(penHandle(p(0, 0), p(1, 0), 2)).toBeNull();
    expect(penHandle(p(0, 0), p(5, 0), 2)).toEqual(p(5, 0));
  });
});
