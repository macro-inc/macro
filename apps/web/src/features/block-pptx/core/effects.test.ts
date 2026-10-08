import { describe, expect, it } from 'vitest';
import {
  GLOW_COLORS,
  GLOW_SIZES,
  glowCss,
  perspectiveShadowStyle,
  REFLECTION_PRESETS,
  rgba,
  SHADOW_GROUPS,
  SOFT_EDGE_SIZES,
  shadowCss,
  shadowOffset,
  shadowPreset,
} from './effects';

describe('effect galleries', () => {
  it('lists PowerPoint’s shadow presets in gallery order', () => {
    expect(SHADOW_GROUPS.map((g) => [g.label, g.presets.length])).toEqual([
      ['Outer', 9],
      ['Inner', 9],
      ['Perspective', 5],
    ]);
    const ids = SHADOW_GROUPS.flatMap((g) => g.presets.map((p) => p.id));
    expect(new Set(ids).size).toBe(23);
    expect(ids.slice(0, 3)).toEqual([
      'outerBottomRight',
      'outerBottom',
      'outerBottomLeft',
    ]);
    expect(shadowPreset('outerBottomRight')).toMatchObject({
      label: 'Offset: Bottom Right',
      blurPt: 4,
      distancePt: 3,
      angleDeg: 45,
    });
    expect(shadowPreset('innerCenter')?.label).toBe('Inside: Center');
  });

  it('lists reflections, glows, and soft edges', () => {
    expect(REFLECTION_PRESETS.map((p) => p.id)).toEqual([
      'tightTouching',
      'halfTouching',
      'fullTouching',
      'tight4pt',
      'half4pt',
      'full4pt',
      'tight8pt',
      'half8pt',
      'full8pt',
    ]);
    expect(REFLECTION_PRESETS[4]).toMatchObject({
      label: 'Half Reflection: 4 pt offset',
      sizePct: 55,
      distancePt: 4,
    });
    expect(GLOW_SIZES).toEqual([5, 8, 11, 18]);
    expect(GLOW_COLORS).toHaveLength(6);
    expect(SOFT_EDGE_SIZES).toEqual([1, 2.5, 5, 10, 25, 50]);
  });
});

describe('effect previews', () => {
  it('offsets shadows clockwise from the right', () => {
    const down = shadowOffset(10, 90);
    expect(down.x).toBeCloseTo(0, 6);
    expect(down.y).toBeCloseTo(10, 6);
    const css = shadowCss(
      {
        kind: 'outer',
        blurPt: 4,
        distancePt: 3,
        angleDeg: 45,
        color: '#000000',
        transparency: 0.6,
      },
      1
    );
    expect(css).toBe('2.12px 2.12px 4.00px 0.00px rgba(0, 0, 0, 0.400)');
    expect(
      shadowCss(
        {
          kind: 'inner',
          blurPt: 5,
          distancePt: 0,
          angleDeg: 0,
          color: '4472C4',
          transparency: 0,
        },
        2
      )
    ).toBe('inset 0.00px 0.00px 10.00px 0.00px rgba(68, 114, 196, 1.000)');
  });

  it('draws glows and perspective shadows', () => {
    expect(rgba('#FF8000', 0.5)).toBe('rgba(255, 128, 0, 0.500)');
    expect(glowCss('#FF0000', 10, 0.6, 1)).toBe(
      '0 0 9.00px 4.50px rgba(255, 0, 0, 0.400)'
    );
    const below = perspectiveShadowStyle(shadowPreset('perspectiveBelow')!, 1);
    expect(below['transform-origin']).toBe('center bottom');
    expect(below.transform).toContain('scale(0.9, -0.19)');
  });
});
