import type { PaintInfo, StopInfo } from '@core/fig-engine/types';
import { describe, expect, it } from 'vitest';
import {
  addStop,
  colorAt,
  copyPaint,
  editPaint,
  movePaint,
  moveStop,
  parseDashes,
  recolorStop,
  removeStop,
  stopHex,
} from './paint';

const stops: StopInfo[] = [
  { color: 'FF0000', alpha: 1, position: 0 },
  { color: '0000FF', alpha: 0, position: 1 },
];

const paint = (color: string): PaintInfo => ({
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

describe('gradient stops', () => {
  it('writes stop colors with alpha', () => {
    expect(stopHex(stops[0])).toBe('FF0000');
    expect(stopHex(stops[1])).toBe('0000FF00');
  });

  it('interpolates the color between stops', () => {
    expect(colorAt(stops, 0.5)).toBe('80008080');
    expect(colorAt(stops, -1)).toBe('FF0000');
    expect(colorAt(stops, 2)).toBe('0000FF00');
  });

  it('adds a stop in the gradient color where clicked', () => {
    const added = addStop(stops, 0.5);
    expect(added.index).toBe(1);
    expect(added.stops).toEqual([
      { color: 'FF0000', position: 0 },
      { color: '80008080', position: 0.5 },
      { color: '0000FF00', position: 1 },
    ]);
  });

  it('moves a stop past another, following it', () => {
    const moved = moveStop(
      [...stops, { color: '00FF00', alpha: 1, position: 0.5 }],
      0,
      0.75
    );
    expect(moved.stops.map((s) => s.position)).toEqual([0.5, 0.75, 1]);
    expect(moved.index).toBe(1);
  });

  it('recolors and removes stops, keeping two', () => {
    expect(recolorStop(stops, 1, '00FF00')[1]).toEqual({
      color: '00FF00',
      position: 1,
    });
    expect(removeStop(stops, 0)).toBeUndefined();
    const three = [...stops, { color: '00FF00', alpha: 1, position: 0.5 }];
    expect(removeStop(three, 2)?.length).toBe(2);
  });
});

describe('paint lists', () => {
  it('edits one paint and keeps the rest', () => {
    const paints = [paint('FF0000'), paint('00FF00')];
    expect(
      editPaint(paints, 1, (spec) => ({ ...spec, visible: false }))
    ).toEqual([{ keep: 0 }, { keep: 1, visible: false }]);
    expect(editPaint(paints, 0, () => null)).toEqual([{ keep: 1 }]);
  });

  it('reorders paints', () => {
    expect(movePaint(3, 0, 2)).toEqual([{ keep: 1 }, { keep: 2 }, { keep: 0 }]);
    expect(movePaint(3, 2, 0)).toEqual([{ keep: 2 }, { keep: 0 }, { keep: 1 }]);
    expect(movePaint(2, 1, 1)).toEqual([{ keep: 0 }, { keep: 1 }]);
  });
});

describe('dashes', () => {
  it('parses dash patterns', () => {
    expect(parseDashes('4, 2')).toEqual([4, 2]);
    expect(parseDashes('4 2 1 2')).toEqual([4, 2, 1, 2]);
    expect(parseDashes('5')).toEqual([5, 5]);
    expect(parseDashes('')).toEqual([]);
    expect(parseDashes('0')).toEqual([]);
    expect(parseDashes('a, 2')).toBeNull();
    expect(parseDashes('-1')).toBeNull();
  });
});

describe('copying paints between fills and strokes', () => {
  it('copies solids with their alpha, gradients with stops, and images', () => {
    expect(copyPaint({ ...paint('FF0000'), alpha: 0.5, opacity: 0.8 })).toEqual(
      { type: 'SOLID', color: 'FF000080', opacity: 0.8, visible: true }
    );
    expect(
      copyPaint({ ...paint('000000'), type: 'GRADIENT_LINEAR', stops })
    ).toEqual({
      type: 'GRADIENT_LINEAR',
      stops: [
        { color: 'FF0000', position: 0 },
        { color: '0000FF00', position: 1 },
      ],
      opacity: 1,
      visible: true,
    });
    expect(
      copyPaint({ ...paint('000000'), type: 'IMAGE', imageHash: 'abc' })
    ).toEqual({ image: 'abc', opacity: 1, visible: true });
    expect(copyPaint({ ...paint('000000'), type: 'VIDEO' })).toBeNull();
  });
});
