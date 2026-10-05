import { describe, expect, it } from 'vitest';
import {
  closesPath,
  deleteVertex,
  dragHandle,
  hitVector,
  moveHandle,
  moveVertex,
  type PenPoint,
  penNetwork,
  segmentCurve,
  vertexHandles,
} from './vector';

const corner = (x: number, y: number): PenPoint => ({
  x,
  y,
  handle: { x: 0, y: 0 },
});

describe('penNetwork', () => {
  it('joins points in order with straight segments', () => {
    const net = penNetwork(
      [corner(0, 0), corner(10, 0), corner(10, 10)],
      false
    );
    expect(net.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(net.segments.map((s) => [s.start, s.end])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(net.regions).toEqual([]);
  });

  it('closes a path into one filled region', () => {
    const net = penNetwork([corner(0, 0), corner(10, 0), corner(5, 8)], true);
    expect(net.segments.at(-1)).toMatchObject({ start: 2, end: 0 });
    expect(net.regions).toEqual([
      { windingRule: 'NONZERO', loops: [[0, 1, 2]] },
    ]);
  });

  it('mirrors a dragged point’s handle on its incoming side', () => {
    const smooth = { x: 10, y: 0, handle: { x: 4, y: 2 } };
    const net = penNetwork([corner(0, 0), smooth, corner(20, 0)], false);
    expect(net.segments[0].tangentEnd).toEqual({ x: -4, y: -2 });
    expect(net.segments[1].tangentStart).toEqual({ x: 4, y: 2 });
    expect(segmentCurve(net, net.segments[0])[2]).toEqual({ x: 6, y: -2 });
  });
});

describe('closesPath and dragHandle', () => {
  it('closes on the first point once there is a shape', () => {
    const points = [corner(0, 0), corner(10, 0), corner(10, 10)];
    expect(closesPath(points, { x: 1, y: 1 }, 3)).toBe(true);
    expect(closesPath(points, { x: 5, y: 5 }, 3)).toBe(false);
    expect(closesPath(points.slice(0, 2), { x: 0, y: 0 }, 3)).toBe(false);
  });

  it('ignores tiny drags', () => {
    expect(dragHandle({ x: 0, y: 0 }, { x: 0.5, y: 0 }, 2)).toEqual({
      x: 0,
      y: 0,
    });
    expect(dragHandle({ x: 0, y: 0 }, { x: 5, y: 3 }, 2)).toEqual({
      x: 5,
      y: 3,
    });
  });
});

describe('editing points', () => {
  const smooth = penNetwork(
    [corner(0, 0), { x: 10, y: 0, handle: { x: 4, y: 0 } }, corner(20, 0)],
    false
  );

  it('hits handles of the selected point before points', () => {
    expect(hitVector(smooth, { x: 0.5, y: 0 }, 2)).toEqual({
      kind: 'vertex',
      index: 0,
    });
    expect(hitVector(smooth, { x: 14, y: 0 }, 1, 1)).toEqual({
      kind: 'handle',
      segment: 1,
      end: 'start',
    });
    expect(hitVector(smooth, { x: 50, y: 50 }, 2)).toBeUndefined();
    expect(vertexHandles(smooth, 1)).toHaveLength(2);
  });

  it('moves a point with its handles', () => {
    const moved = moveVertex(smooth, 1, { x: 10, y: 5 });
    expect(moved.vertices[1]).toEqual({ x: 10, y: 5 });
    expect(segmentCurve(moved, moved.segments[1])[1]).toEqual({ x: 14, y: 5 });
  });

  it('mirrors the opposite handle', () => {
    const turned = moveHandle(
      smooth,
      { segment: 1, end: 'start' },
      { x: 10, y: 6 },
      true
    );
    expect(turned.segments[1].tangentStart).toEqual({ x: 0, y: 6 });
    expect(turned.segments[0].tangentEnd).toEqual({ x: 0, y: -6 });
    const broken = moveHandle(
      smooth,
      { segment: 1, end: 'start' },
      { x: 10, y: 6 },
      false
    );
    expect(broken.segments[0].tangentEnd).toEqual({ x: -4, y: 0 });
  });

  it('deletes a point with its segments and loops', () => {
    const triangle = penNetwork(
      [corner(0, 0), corner(10, 0), corner(5, 8)],
      true
    );
    const left = deleteVertex(triangle, 1);
    expect(left.vertices).toHaveLength(2);
    expect(left.segments.map((s) => [s.start, s.end])).toEqual([[1, 0]]);
    expect(left.regions).toEqual([]);
  });
});
