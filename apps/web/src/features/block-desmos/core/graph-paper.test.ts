import { describe, expect, it } from 'vitest';
import {
  niceStep,
  screenToWorld,
  squareUnits,
  worldToScreen,
  zoomViewport,
} from './graph-paper';

describe('graph paper math', () => {
  const viewport = { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };

  it('round-trips the origin', () => {
    const [sx, sy] = worldToScreen(viewport, 400, 400, 0, 0);
    expect(sx).toBeCloseTo(200);
    expect(sy).toBeCloseTo(200);
    const [x, y] = screenToWorld(viewport, 400, 400, sx, sy);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
  });

  it('picks a 2-5-10 tick', () => {
    expect(niceStep(20)).toBe(2);
    expect(niceStep(100)).toBe(10);
  });

  it('zooms in around a point without moving that point', () => {
    const next = zoomViewport(viewport, 0.5, 2, 3);
    expect(next.xmin).toBeLessThan(2);
    expect(next.xmax).toBeGreaterThan(2);
    expect(next.xmax - next.xmin).toBeCloseTo(10);
  });

  it('keeps graph units square on a wide canvas', () => {
    const next = squareUnits(viewport, 800, 400);
    expect(next.xmax - next.xmin).toBeCloseTo(20);
    expect(next.ymax - next.ymin).toBeCloseTo(10);
  });
});
