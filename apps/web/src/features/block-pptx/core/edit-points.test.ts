import type { GeometryPath } from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import {
  addNode,
  bendSegment,
  closeSubpath,
  cubicAt,
  deleteNode,
  deleteSegment,
  type EditShape,
  fromGeometry,
  handles,
  hitHandle,
  hitNode,
  hitSegment,
  moveHandle,
  moveNode,
  nodeCount,
  openAt,
  pathData,
  segmentPoints,
  setNodeKind,
  setSegmentCurved,
  toGeometry,
} from './edit-points';
import type { Affine } from './geometry';

const square: GeometryPath = {
  commands: [
    { cmd: 'moveTo', x: 0, y: 0 },
    { cmd: 'lineTo', x: 100, y: 0 },
    { cmd: 'lineTo', x: 100, y: 100 },
    { cmd: 'lineTo', x: 0, y: 100 },
    { cmd: 'close' },
  ],
  fill: 'norm',
  stroke: true,
};

/** A circle of radius 50 around (50, 50), as the engine reads an ellipse. */
const K = 0.5523 * 50;
const circle: GeometryPath = {
  commands: [
    { cmd: 'moveTo', x: 0, y: 50 },
    { cmd: 'cubicBezTo', x1: 0, y1: 50 - K, x2: 50 - K, y2: 0, x: 50, y: 0 },
    {
      cmd: 'cubicBezTo',
      x1: 50 + K,
      y1: 0,
      x2: 100,
      y2: 50 - K,
      x: 100,
      y: 50,
    },
    {
      cmd: 'cubicBezTo',
      x1: 100,
      y1: 50 + K,
      x2: 50 + K,
      y2: 100,
      x: 50,
      y: 100,
    },
    { cmd: 'cubicBezTo', x1: 50 - K, y1: 100, x2: 0, y2: 50 + K, x: 0, y: 50 },
    { cmd: 'close' },
  ],
};

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];
const ref = (node: number) => ({ path: 0, sub: 0, node });
const seg = (n: number) => ({ path: 0, sub: 0, seg: n });
const sub0 = (s: EditShape) => s[0].subpaths[0];

describe('conversion', () => {
  it('reads a closed polygon as vertices and straight segments', () => {
    const shape = fromGeometry([square]);
    const s = sub0(shape);
    expect(s.closed).toBe(true);
    expect(s.nodes.map((n) => n.p)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    expect(s.segments).toHaveLength(4);
    expect(s.nodes.every((n) => n.kind === 'corner')).toBe(true);
  });

  it('joins a curve that comes back to the start, and infers smooth points', () => {
    const s = sub0(fromGeometry([circle]));
    expect(s.nodes).toHaveLength(4);
    expect(s.segments).toHaveLength(4);
    expect(s.segments.every((x) => x.curve)).toBe(true);
    expect(s.nodes.every((n) => n.kind === 'smooth')).toBe(true);
  });

  it('writes back what it read', () => {
    expect(toGeometry(fromGeometry([square]))).toEqual([
      { ...square, fill: 'norm', stroke: true },
    ]);
    const again = fromGeometry(toGeometry(fromGeometry([circle])));
    expect(again[0].subpaths).toEqual(fromGeometry([circle])[0].subpaths);
  });

  it('turns quadratic curves into cubics and keeps several sub-paths', () => {
    const shape = fromGeometry([
      {
        commands: [
          { cmd: 'moveTo', x: 0, y: 0 },
          { cmd: 'quadBezTo', x1: 30, y1: 60, x: 60, y: 0 },
          { cmd: 'moveTo', x: 10, y: 10 },
          { cmd: 'lineTo', x: 20, y: 10 },
        ],
      },
    ]);
    expect(shape[0].subpaths).toHaveLength(2);
    const c = shape[0].subpaths[0].segments[0];
    expect(c.curve && c.c1).toEqual({ x: 20, y: 40 });
    expect(c.curve && c.c2).toEqual({ x: 40, y: 40 });
    expect(shape[0].subpaths[1].closed).toBe(false);
  });
});

describe('hit testing', () => {
  // 2 px per point, shifted by (10, 20).
  const toScreen: Affine = [2, 0, 0, 2, 10, 20];
  const shape = fromGeometry([square]);

  it('finds vertices within the radius', () => {
    expect(hitNode(shape, toScreen, { x: 212, y: 18 }, 5)).toEqual(ref(1));
    expect(hitNode(shape, toScreen, { x: 230, y: 18 }, 5)).toBeUndefined();
  });

  it('finds the segment and where on it', () => {
    const hit = hitSegment(shape, toScreen, { x: 110, y: 22 }, 5);
    expect(hit?.ref).toEqual(seg(0));
    expect(hit?.t).toBeCloseTo(0.5, 2);
    expect(hitSegment(shape, toScreen, { x: 110, y: 120 }, 5)).toBeUndefined();
  });

  it('finds a selected vertex handle, a third along a straight side', () => {
    const hs = handles(sub0(shape), 1);
    expect(hs.map((h) => h.side)).toEqual(['in', 'out']);
    expect(hs[1].at.x).toBeCloseTo(100);
    expect(hs[1].at.y).toBeCloseTo(100 / 3);
    expect(
      hitHandle(shape, ref(1), toScreen, { x: 210, y: 20 + 200 / 3 }, 5)
    ).toBe('out');
  });

  it('draws rotated outlines through the transform', () => {
    const d = pathData(fromGeometry([square]), [0, 1, -1, 0, 0, 0]);
    expect(d.startsWith('M0.00 0.00 L0.00 100.00')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });
});

describe('editing', () => {
  it('moves a vertex with its handles', () => {
    const shape = fromGeometry([circle]);
    const moved = moveNode(shape, ref(1), { x: 50, y: -20 });
    const s = sub0(moved);
    expect(s.nodes[1].p).toEqual({ x: 50, y: -20 });
    const before = segmentPoints(sub0(shape), 0)[2];
    expect(segmentPoints(s, 0)[2]).toEqual({ x: before.x, y: before.y - 20 });
  });

  it('adds a point without changing the outline', () => {
    const shape = fromGeometry([circle]);
    const { shape: next, node } = addNode(shape, seg(0), 0.5);
    expect(node).toEqual(ref(1));
    expect(nodeCount(next)).toBe(5);
    const mid = cubicAt(segmentPoints(sub0(shape), 0), 0.5);
    expect(sub0(next).nodes[1].p.x).toBeCloseTo(mid.x);
    expect(sub0(next).nodes[1].kind).toBe('smooth');
    // On a straight side, a corner point on the line.
    const line = addNode(fromGeometry([square]), seg(1), 0.25);
    expect(sub0(line.shape).nodes[2].p).toEqual({ x: 100, y: 25 });
    expect(sub0(line.shape).segments).toHaveLength(5);
  });

  it('deletes points, joining their segments', () => {
    const shape = fromGeometry([square]);
    const tri = deleteNode(shape, ref(2));
    expect(tri && sub0(tri).nodes.map((n) => n.p)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ]);
    expect(tri && sub0(tri).segments).toHaveLength(3);
    // The first vertex of a closed path: the closing side takes over.
    const first = deleteNode(shape, ref(0));
    expect(first && sub0(first).nodes[0].p).toEqual({ x: 100, y: 0 });
    expect(first && sub0(first).segments).toHaveLength(3);
    // Curves stay curved.
    const round = deleteNode(fromGeometry([circle]), ref(1));
    expect(round && sub0(round).segments[0].curve).toBe(true);
    // The last two points cannot all go.
    const line = fromGeometry([
      {
        commands: [
          { cmd: 'moveTo', x: 0, y: 0 },
          { cmd: 'lineTo', x: 10, y: 0 },
        ],
      },
    ]);
    expect(deleteNode(line, ref(0))).toBeNull();
  });

  it('opens and closes paths', () => {
    const open = openAt(fromGeometry([square]), ref(2));
    const s = sub0(open);
    expect(s.closed).toBe(false);
    expect(s.nodes[0].p).toEqual({ x: 100, y: 100 });
    expect(s.nodes[4].p).toEqual({ x: 100, y: 100 });
    expect(s.segments).toHaveLength(4);
    // Ends that meet join again.
    const closed = closeSubpath(open, { path: 0, sub: 0 });
    expect(sub0(closed).closed).toBe(true);
    expect(sub0(closed).nodes).toHaveLength(4);
    // Ends apart get a straight side.
    const cut = deleteSegment(fromGeometry([square]), seg(3));
    expect(cut && sub0(cut).closed).toBe(false);
    expect(cut && sub0(cut).segments).toHaveLength(3);
    const reclosed = cut && closeSubpath(cut, { path: 0, sub: 0 });
    expect(reclosed && sub0(reclosed).segments).toHaveLength(4);
    expect(reclosed && toGeometry(reclosed)[0].commands.at(-1)).toEqual({
      cmd: 'close',
    });
  });

  it('makes smooth, straight, and corner points', () => {
    const shape = fromGeometry([square]);
    const smooth = setNodeKind(shape, ref(1), 'smooth');
    const s = sub0(smooth);
    expect(s.segments[0].curve && s.segments[1].curve).toBe(true);
    const [hin, hout] = handles(s, 1).map((h) => h.at);
    const p = s.nodes[1].p;
    // Opposite and equally long.
    expect(hin.x + hout.x).toBeCloseTo(2 * p.x);
    expect(hin.y + hout.y).toBeCloseTo(2 * p.y);
    // Dragging one handle of a smooth point mirrors the other.
    const dragged = moveHandle(smooth, ref(1), 'out', { x: 130, y: 0 });
    const [din, dout] = handles(sub0(dragged), 1).map((h) => h.at);
    expect(dout).toEqual({ x: 130, y: 0 });
    expect(din.x).toBeCloseTo(70);
    expect(din.y).toBeCloseTo(0);
    // A straight point keeps the other handle's length.
    const straight = setNodeKind(dragged, ref(1), 'straight');
    const long = moveHandle(straight, ref(1), 'out', { x: 100, y: 60 });
    const [lin] = handles(sub0(long), 1).map((h) => h.at);
    expect(lin.x).toBeCloseTo(100);
    expect(lin.y).toBeCloseTo(-30);
    // A corner point moves one handle only.
    const corner = setNodeKind(long, ref(1), 'corner');
    const free = moveHandle(corner, ref(1), 'out', { x: 150, y: 50 });
    expect(handles(sub0(free), 1)[0].at).toEqual(lin);
  });

  it('bends a segment so the grabbed point follows the pointer', () => {
    const shape = fromGeometry([square]);
    const bent = bendSegment(shape, seg(0), 0.5, { x: 0, y: -30 });
    const s = sub0(bent);
    expect(s.segments[0].curve).toBe(true);
    const mid = cubicAt(segmentPoints(s, 0), 0.5);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(-30);
    // The vertices stay.
    expect(s.nodes[0].p).toEqual({ x: 0, y: 0 });
    expect(s.nodes[1].p).toEqual({ x: 100, y: 0 });
  });

  it('switches segments between straight and curved', () => {
    const curved = setSegmentCurved(fromGeometry([square]), seg(0), true);
    expect(sub0(curved).segments[0].curve).toBe(true);
    // A new curve follows the old line.
    const mid = cubicAt(segmentPoints(sub0(curved), 0), 0.5);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(0);
    const straight = setSegmentCurved(curved, seg(0), false);
    expect(sub0(straight).segments[0].curve).toBe(false);
  });

  it('keeps hit testing on the identity transform', () => {
    expect(
      hitNode(fromGeometry([square]), IDENTITY, { x: 1, y: 1 }, 3)
    ).toEqual(ref(0));
  });
});
