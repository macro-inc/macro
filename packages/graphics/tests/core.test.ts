import { describe, expect, it, vi } from 'vitest';
import {
  createGraphicsEditor,
  MAX_SCALE,
  MIN_SCALE,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from '../src/core';

describe('camera', () => {
  it('round trips world coordinates through a translated, zoomed viewport', () => {
    const camera = { x: -423, y: 92, scale: 0.25 };
    const point = { x: -1500, y: 808 };
    expect(screenToWorld(camera, worldToScreen(camera, point))).toEqual(point);
  });
  it.each([0.0001, 0.3, 2, 100])(
    'preserves the world point at the zoom anchor (%s)',
    (scale) => {
      const camera = { x: 32, y: -18, scale: 1.5 };
      const anchor = { x: 241, y: 173 };
      const next = zoomAt(camera, anchor, scale);
      const before = screenToWorld(camera, anchor);
      const after = screenToWorld(next, anchor);
      expect(after.x).toBeCloseTo(before.x);
      expect(after.y).toBeCloseTo(before.y);
      expect(next.scale).toBeGreaterThanOrEqual(MIN_SCALE);
      expect(next.scale).toBeLessThanOrEqual(MAX_SCALE);
    }
  );
  it('isolates instances, rejects nonfinite input and stops notifications after disposal', () => {
    const first = createGraphicsEditor();
    const second = createGraphicsEditor();
    const listener = vi.fn();
    first.subscribeCamera(listener);
    first.panBy({ x: 30, y: -10 });
    expect(second.getCamera()).toEqual({ x: 0, y: 0, scale: 1 });
    first.panBy({ x: Infinity, y: 0 });
    first.zoomAt({ x: 0, y: 0 }, NaN);
    expect(listener).toHaveBeenCalledTimes(1);
    first.dispose();
    first.resetCamera();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
