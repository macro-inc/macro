import { describe, expect, it } from 'vitest';
import {
  colorHex,
  colorLabel,
  DEFAULT_APPEARANCE,
  formatDash,
  type Paint,
  paintCss,
  paintHex,
  parseDash,
  solidPaint,
  strokeOf,
  swapAppearance,
} from './paint';

describe('colors', () => {
  it('show any space as sRGB hex', () => {
    expect(colorHex({ space: 'rgb', r: 1, g: 0.5, b: 0 })).toBe('FF8000');
    expect(colorHex({ space: 'gray', g: 0 })).toBe('000000');
    expect(colorHex({ space: 'cmyk', c: 0, m: 1, y: 1, k: 0 })).toBe('FF0000');
    expect(
      colorHex({
        space: 'spot',
        name: 'PANTONE 300 C',
        tint: 1,
        rgb: [0, 0.37, 0.72],
      })
    ).toBe('005EB8');
  });

  it('are labelled in their own space', () => {
    expect(colorLabel({ space: 'cmyk', c: 0.1, m: 0, y: 0, k: 0.5 })).toBe(
      'CMYK 10/0/0/50'
    );
    expect(colorLabel({ space: 'gray', g: 0.25 })).toBe('Gray 75%');
  });
});

describe('paints', () => {
  it('parse typed hex', () => {
    expect(solidPaint('#f00')).toEqual({
      type: 'solid',
      color: { space: 'rgb', r: 1, g: 0, b: 0 },
    });
    expect(solidPaint('nope')).toBeUndefined();
  });

  it('preview solids and gradients', () => {
    const gradient: Paint = {
      type: 'gradient',
      gradient: {
        transform: [1, 0, 0, 1, 0, 0],
        radial: false,
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
        startRadius: 0,
        endRadius: 0,
        stops: [
          { offset: 1, color: { space: 'gray', g: 1 }, opacity: 1 },
          { offset: 0, color: { space: 'gray', g: 0 }, opacity: 0.5 },
        ],
        extend: [true, true],
      },
    };
    expect(paintCss(null)).toBe('transparent');
    expect(paintCss(solidPaint('00ff00'))).toBe('#00FF00');
    expect(paintCss(gradient)).toBe(
      'linear-gradient(90deg, rgba(0, 0, 0, 0.5) 0%, rgba(255, 255, 255, 1) 100%)'
    );
    expect(paintHex(gradient)).toBe('FFFFFF');
  });

  it('swap fill and stroke, keeping the stroke settings', () => {
    const swapped = swapAppearance(DEFAULT_APPEARANCE);
    expect(swapped.fill).toEqual(DEFAULT_APPEARANCE.stroke?.paint);
    expect(swapped.stroke).toEqual(
      strokeOf(DEFAULT_APPEARANCE.fill as Paint, 1)
    );
    expect(swapAppearance({ fill: null, stroke: null })).toEqual({
      fill: null,
      stroke: null,
    });
  });

  it('read and write dashes', () => {
    expect(parseDash('4, 2')).toEqual([4, 2]);
    expect(parseDash('none')).toEqual([]);
    expect(parseDash('a')).toBeUndefined();
    expect(formatDash([])).toBe('None');
    expect(formatDash([3, 1])).toBe('3, 1');
  });
});
