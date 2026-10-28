import type { Gradient } from '@core/psd-engine/types';
import { describe, expect, it } from 'vitest';
import { endColor, recolorEnd, twoColorGradient } from './gradient';

const RED = { r: 1, g: 0, b: 0 };
const GREEN = { r: 0, g: 1, b: 0 };
const BLUE = { r: 0, g: 0, b: 1 };

describe('gradients', () => {
  it('makes new gradients that mix colors perceptually', () => {
    const g = twoColorGradient(RED, BLUE);
    expect(g.method).toBe('perceptual');
    expect(endColor(g, 'first')).toEqual(RED);
    expect(endColor(g, 'last')).toEqual(BLUE);
  });

  it('recolors an end and keeps the stops between and the method', () => {
    const g: Gradient = {
      ...twoColorGradient(RED, BLUE, 'Three', 'smooth'),
      colors: [
        { location: 0, midpoint: 0.5, color: RED },
        { location: 0.4, midpoint: 0.3, color: GREEN },
        { location: 1, midpoint: 0.5, color: BLUE },
      ],
    };
    const last = recolorEnd(g, 'last', GREEN);
    expect(last.colors.map((s) => s.color)).toEqual([RED, GREEN, GREEN]);
    expect(last.colors[1]).toEqual(g.colors[1]);
    expect(last.method).toBe('smooth');
    const first = recolorEnd(g, 'first', BLUE);
    expect(first.colors.map((s) => s.color)).toEqual([BLUE, GREEN, BLUE]);
  });

  it('gives a gradient without stops two', () => {
    const empty = { ...twoColorGradient(RED, BLUE), colors: [] };
    expect(endColor(empty, 'first')).toEqual({ r: 0, g: 0, b: 0 });
    const g = recolorEnd(empty, 'last', GREEN);
    expect(g.colors.map((s) => s.color)).toEqual([{ r: 0, g: 0, b: 0 }, GREEN]);
  });
});
