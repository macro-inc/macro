/**
 * PowerPoint's shape and text effect galleries (Shadow, Reflection, Glow,
 * Soft Edges) as data, with the values the engine gives each preset, and
 * the CSS that previews them on small gallery tiles.
 */

import type {
  ReflectionPreset,
  ShadowOutline,
  ShadowPreset,
} from '@core/pptx-engine/types';

/** One preset of the Shadow gallery, with the engine's values for it. */
export interface ShadowPresetInfo {
  id: ShadowPreset;
  label: string;
  kind: 'outer' | 'inner' | 'perspective';
  blurPt: number;
  distancePt: number;
  angleDeg: number;
  /** Scale (percent) and skew (degrees) of perspective shadows. */
  sx: number;
  sy: number;
  kx: number;
  /** The point the shadow scales and skews about. */
  align: string;
  /** Opacity of the black shadow. */
  alpha: number;
}

const outer = (
  id: ShadowPreset,
  label: string,
  angleDeg: number,
  align: string
): ShadowPresetInfo => ({
  id,
  label: `Offset: ${label}`,
  kind: 'outer',
  blurPt: 4,
  distancePt: 3,
  angleDeg,
  sx: 100,
  sy: 100,
  kx: 0,
  align,
  alpha: 0.4,
});

const inner = (
  id: ShadowPreset,
  label: string,
  angleDeg: number
): ShadowPresetInfo => ({
  id,
  label: `Inside: ${label}`,
  kind: 'inner',
  blurPt: 5,
  distancePt: 4,
  angleDeg,
  sx: 100,
  sy: 100,
  kx: 0,
  align: 'ctr',
  alpha: 0.5,
});

const perspective = (
  id: ShadowPreset,
  label: string,
  [blurPt, distancePt, angleDeg]: [number, number, number],
  [sx, sy, kx]: [number, number, number],
  align: string,
  alpha: number
): ShadowPresetInfo => ({
  id,
  label: `Perspective: ${label}`,
  kind: 'perspective',
  blurPt,
  distancePt,
  angleDeg,
  sx,
  sy,
  kx,
  align,
  alpha,
});

/** The Shadow gallery: Outer and Inner (3 × 3) and Perspective. */
export const SHADOW_GROUPS: { label: string; presets: ShadowPresetInfo[] }[] = [
  {
    label: 'Outer',
    presets: [
      outer('outerBottomRight', 'Bottom Right', 45, 'tl'),
      outer('outerBottom', 'Bottom', 90, 't'),
      outer('outerBottomLeft', 'Bottom Left', 135, 'tr'),
      outer('outerRight', 'Right', 0, 'l'),
      {
        ...outer('outerCenter', 'Center', 0, 'ctr'),
        blurPt: 5,
        distancePt: 0,
        sx: 102,
        sy: 102,
      },
      outer('outerLeft', 'Left', 180, 'r'),
      outer('outerTopRight', 'Top Right', 315, 'bl'),
      outer('outerTop', 'Top', 270, 'b'),
      outer('outerTopLeft', 'Top Left', 225, 'br'),
    ],
  },
  {
    label: 'Inner',
    presets: [
      inner('innerTopLeft', 'Top Left', 45),
      inner('innerTop', 'Top', 90),
      inner('innerTopRight', 'Top Right', 135),
      inner('innerLeft', 'Left', 0),
      {
        ...inner('innerCenter', 'Center', 0),
        blurPt: 9,
        distancePt: 0,
        alpha: 1,
      },
      inner('innerRight', 'Right', 180),
      inner('innerBottomLeft', 'Bottom Left', 315),
      inner('innerBottom', 'Bottom', 270),
      inner('innerBottomRight', 'Bottom Right', 225),
    ],
  },
  {
    label: 'Perspective',
    presets: [
      perspective(
        'perspectiveUpperLeft',
        'Upper Left',
        [6, 0, 225],
        [100, 23, 20],
        'br',
        0.2
      ),
      perspective(
        'perspectiveUpperRight',
        'Upper Right',
        [6, 0, 315],
        [100, 23, -20],
        'bl',
        0.2
      ),
      perspective(
        'perspectiveBelow',
        'Below',
        [12, 25, 90],
        [90, -19, 0],
        'b',
        0.15
      ),
      perspective(
        'perspectiveLowerLeft',
        'Lower Left',
        [6, 1, 135],
        [100, -23, 13.34],
        'bl',
        0.2
      ),
      perspective(
        'perspectiveLowerRight',
        'Lower Right',
        [6, 1, 45],
        [100, -23, -13.34],
        'br',
        0.2
      ),
    ],
  },
];

export function shadowPreset(id: ShadowPreset): ShadowPresetInfo | undefined {
  for (const group of SHADOW_GROUPS)
    for (const p of group.presets) if (p.id === id) return p;
  return undefined;
}

/** One preset of the Reflection gallery. */
export interface ReflectionPresetInfo {
  id: ReflectionPreset;
  label: string;
  /** Percent of the shape's height reflected. */
  sizePct: number;
  distancePt: number;
}

const REFLECTION_KINDS: [string, string, number][] = [
  ['tight', 'Tight Reflection', 35],
  ['half', 'Half Reflection', 55],
  ['full', 'Full Reflection', 90],
];
const REFLECTION_GAPS: [string, string, number][] = [
  ['Touching', 'Touching', 0],
  ['4pt', '4 pt offset', 4],
  ['8pt', '8 pt offset', 8],
];

/** The Reflection gallery: tight, half, and full, touching or 4 or 8 pt away. */
export const REFLECTION_PRESETS: ReflectionPresetInfo[] =
  REFLECTION_GAPS.flatMap(([gap, gapLabel, distancePt]) =>
    REFLECTION_KINDS.map(([kind, kindLabel, sizePct]) => ({
      id: `${kind}${gap}` as ReflectionPreset,
      label: `${kindLabel}: ${gapLabel}`,
      sizePct,
      distancePt,
    }))
  );

/** Glow sizes of the Glow gallery, in points (rows). */
export const GLOW_SIZES = [5, 8, 11, 18];
/** Theme colors of the Glow gallery (columns). */
export const GLOW_COLORS = [
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
];
/** Transparency of gallery glows. */
export const GLOW_TRANSPARENCY = 0.6;
/** Soft edge sizes of the Soft Edges gallery, in points. */
export const SOFT_EDGE_SIZES = [1, 2.5, 5, 10, 25, 50];

/** `#RRGGBB` (or `RRGGBB`) with an opacity, as CSS. */
export function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/** The x/y offset of a shadow `distance` away at `angle` (clockwise from the right). */
export function shadowOffset(distance: number, angleDeg: number) {
  const r = (angleDeg * Math.PI) / 180;
  return { x: distance * Math.cos(r), y: distance * Math.sin(r) };
}

/**
 * A CSS `box-shadow` previewing an outer or inner shadow, `scale` CSS pixels
 * per point.
 */
export function shadowCss(
  s: Pick<
    ShadowOutline,
    'kind' | 'blurPt' | 'distancePt' | 'angleDeg' | 'color' | 'transparency'
  > & { sizePct?: number },
  scale: number,
  side = 0
): string {
  const { x, y } = shadowOffset(s.distancePt * scale, s.angleDeg);
  const blur = s.blurPt * scale;
  const color = rgba(s.color, 1 - s.transparency);
  const spread =
    s.kind === 'outer' && s.sizePct && side > 0
      ? ((s.sizePct - 100) / 200) * side
      : 0;
  const px = (v: number) => `${v.toFixed(2)}px`;
  return `${s.kind === 'inner' ? 'inset ' : ''}${px(x)} ${px(y)} ${px(blur)} ${px(spread)} ${color}`;
}

/**
 * The CSS of a gallery shadow preset: black at the preset's opacity, times
 * `boost` (small tiles need darker shadows to read).
 */
export function presetShadowCss(
  p: ShadowPresetInfo,
  scale: number,
  boost = 1
): string {
  return shadowCss(
    {
      kind: p.kind === 'inner' ? 'inner' : 'outer',
      blurPt: p.blurPt,
      distancePt: p.distancePt,
      angleDeg: p.angleDeg,
      color: '#000000',
      transparency: 1 - Math.min(1, p.alpha * boost),
      sizePct: Math.max(p.sx, Math.abs(p.sy)),
    },
    scale,
    40
  );
}

const ALIGN_ORIGIN: Record<string, string> = {
  tl: 'left top',
  t: 'center top',
  tr: 'right top',
  l: 'left center',
  ctr: 'center center',
  r: 'right center',
  bl: 'left bottom',
  b: 'center bottom',
  br: 'right bottom',
};

/**
 * CSS for a perspective shadow drawn as its own layer behind a tile: scaled
 * and skewed about the preset's alignment point, then offset and blurred.
 */
export function perspectiveShadowStyle(
  p: Pick<
    ShadowPresetInfo,
    'sx' | 'sy' | 'kx' | 'align' | 'blurPt' | 'distancePt' | 'angleDeg'
  >,
  scale: number
): Record<string, string> {
  const { x, y } = shadowOffset(p.distancePt * scale, p.angleDeg);
  return {
    'transform-origin': ALIGN_ORIGIN[p.align] ?? 'center center',
    transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) skewX(${-p.kx}deg) scale(${p.sx / 100}, ${p.sy / 100})`,
    filter: `blur(${(p.blurPt * scale * 0.5).toFixed(2)}px)`,
  };
}

/** A CSS `box-shadow` previewing a glow of `sizePt`. */
export function glowCss(
  color: string,
  sizePt: number,
  transparency: number,
  scale: number
): string {
  const size = sizePt * scale;
  return `0 0 ${(size * 0.9).toFixed(2)}px ${(size * 0.45).toFixed(2)}px ${rgba(color, 1 - transparency)}`;
}

/** A CSS `text-shadow` previewing a text glow. */
export function textGlowCss(
  color: string,
  sizePt: number,
  transparency: number,
  scale: number
): string {
  const size = sizePt * scale;
  const c = rgba(color, 1 - transparency);
  return `0 0 ${(size * 0.5).toFixed(2)}px ${c}, 0 0 ${size.toFixed(2)}px ${c}`;
}

/** A CSS `text-shadow` previewing an outer text shadow. */
export function textShadowCss(
  p: Pick<ShadowPresetInfo, 'blurPt' | 'distancePt' | 'angleDeg' | 'alpha'>,
  scale: number
): string {
  const { x, y } = shadowOffset(p.distancePt * scale, p.angleDeg);
  return `${x.toFixed(2)}px ${y.toFixed(2)}px ${(p.blurPt * scale).toFixed(2)}px ${rgba('#000000', p.alpha)}`;
}

/** A CSS mask fading a tile's edges over `sizePt` (soft edges). */
export function softEdgeMask(sizePt: number, scale: number): string {
  const s = `${(sizePt * scale).toFixed(2)}px`;
  return `linear-gradient(to right, transparent, #000 ${s}, #000 calc(100% - ${s}), transparent), linear-gradient(to bottom, transparent, #000 ${s}, #000 calc(100% - ${s}), transparent)`;
}

/** CSS mask of a reflection: from `1 - transparency` down to nothing at `sizePct`. */
export function reflectionMask(transparency: number, sizePct: number): string {
  return `linear-gradient(to bottom, rgba(0,0,0,${(1 - transparency).toFixed(3)}), transparent ${Math.max(1, Math.min(100, sizePct))}%)`;
}
