import type { NodeInfo, PaintInfo } from '@core/fig-engine/types';
import { describe, expect, it } from 'vitest';
import { MIXED, mergeInfos } from './mixed';

const solid = (color: string): PaintInfo => ({
  type: 'SOLID',
  visible: true,
  opacity: 1,
  blendMode: 'NORMAL',
  color,
  alpha: 1,
  stops: null,
  handles: null,
  scaleMode: null,
  imageHash: null,
});

const info = (over: Partial<NodeInfo>): NodeInfo =>
  ({
    id: '1:1',
    type: 'RECTANGLE',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    cornerRadius: null,
    fills: [solid('FF0000')],
    strokes: [],
    strokeWeight: null,
    ...over,
  }) as NodeInfo;

describe('several layers in the design panel', () => {
  it('shows shared values and marks the rest mixed', () => {
    const merged = mergeInfos([
      info({ x: 10, width: 100 }),
      info({ id: '1:2', x: 20, width: 100.001, type: 'ELLIPSE' }),
    ]);
    expect(merged?.count).toBe(2);
    expect(merged?.x).toBe(MIXED);
    expect(merged?.y).toBe(0);
    expect(merged?.width).toBe(100);
    expect(merged?.fills).toEqual([solid('FF0000')]);
    // An ellipse has no corners.
    expect(merged?.radius).toBeUndefined();
    expect(merged?.strokeWeight).toBeUndefined();
    expect(merged?.types).toEqual(['RECTANGLE', 'ELLIPSE']);
  });

  it('compares paints by their look', () => {
    const merged = mergeInfos([
      info({
        fills: [solid('FF0000')],
        strokes: [solid('000000')],
        strokeWeight: 1,
      }),
      info({
        id: '1:2',
        fills: [solid('00FF00')],
        strokes: [solid('000000')],
        strokeWeight: 2,
      }),
    ]);
    expect(merged?.fills).toBe(MIXED);
    expect(merged?.strokes).toEqual([solid('000000')]);
    expect(merged?.strokeWeight).toBe(MIXED);
    expect(mergeInfos([])).toBeUndefined();
  });
});
