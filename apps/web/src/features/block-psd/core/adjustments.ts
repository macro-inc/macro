/**
 * Adjustments as the menus offer them: Photoshop's defaults for a new
 * adjustment layer (or Image > Adjustments dialog) of each kind, and their
 * names.
 */

import type {
  Adjustment,
  AdjustmentType,
  Gradient,
  LevelsChannel,
  Rgb,
} from '@core/psd-engine/types';
import { match } from 'ts-pattern';
import { BLACK, WHITE } from './color';

/** The kinds the editor creates and edits, in Photoshop's menu order. */
export const ADJUSTMENT_TYPES = [
  'brightnessContrast',
  'levels',
  'curves',
  'exposure',
  'vibrance',
  'hueSaturation',
  'colorBalance',
  'blackWhite',
  'photoFilter',
  'channelMixer',
  'invert',
  'posterize',
  'threshold',
  'gradientMap',
] as const satisfies readonly AdjustmentType[];

export type EditableAdjustment = (typeof ADJUSTMENT_TYPES)[number];

export const ADJUSTMENT_LABELS: Record<AdjustmentType, string> = {
  brightnessContrast: 'Brightness/Contrast',
  levels: 'Levels',
  curves: 'Curves',
  exposure: 'Exposure',
  vibrance: 'Vibrance',
  hueSaturation: 'Hue/Saturation',
  colorBalance: 'Color Balance',
  blackWhite: 'Black & White',
  photoFilter: 'Photo Filter',
  channelMixer: 'Channel Mixer',
  invert: 'Invert',
  posterize: 'Posterize',
  threshold: 'Threshold',
  gradientMap: 'Gradient Map',
  selectiveColor: 'Selective Color',
  other: 'Adjustment',
};

export const IDENTITY_LEVELS: LevelsChannel = {
  inBlack: 0,
  inWhite: 255,
  outBlack: 0,
  outWhite: 255,
  gamma: 1,
};

/** Photoshop's Warming Filter (85). */
const WARMING: Rgb = { r: 236 / 255, g: 138 / 255, b: 0 };

/** A two-color gradient from `from` to `to`. */
export function twoColorGradient(from: Rgb, to: Rgb, name = 'Custom'): Gradient {
  return {
    name,
    kind: 'linear',
    angle: 90,
    scale: 1,
    reverse: false,
    dither: false,
    alignWithLayer: true,
    offset: [0, 0],
    smoothness: 1,
    colors: [
      { location: 0, midpoint: 0.5, color: from },
      { location: 1, midpoint: 0.5, color: to },
    ],
    opacities: [
      { location: 0, midpoint: 0.5, opacity: 1 },
      { location: 1, midpoint: 0.5, opacity: 1 },
    ],
  };
}

/** A new adjustment of a kind, with Photoshop's defaults. */
export function defaultAdjustment(type: EditableAdjustment): Adjustment {
  return match(type)
    .returnType<Adjustment>()
    .with('brightnessContrast', () => ({
      type: 'brightnessContrast',
      brightness: 0,
      contrast: 0,
      legacy: false,
    }))
    .with('levels', () => ({
      type: 'levels',
      channels: [
        IDENTITY_LEVELS,
        IDENTITY_LEVELS,
        IDENTITY_LEVELS,
        IDENTITY_LEVELS,
      ],
    }))
    .with('curves', () => ({
      type: 'curves',
      channels: [
        [
          0,
          [
            [0, 0],
            [255, 255],
          ],
        ],
      ],
    }))
    .with('exposure', () => ({
      type: 'exposure',
      exposure: 0,
      offset: 0,
      gamma: 1,
    }))
    .with('vibrance', () => ({ type: 'vibrance', vibrance: 0, saturation: 0 }))
    .with('hueSaturation', () => ({
      type: 'hueSaturation',
      colorize: false,
      colorization: [0, 25, 0],
      master: [0, 0, 0],
      ranges: [],
    }))
    .with('colorBalance', () => ({
      type: 'colorBalance',
      shadows: [0, 0, 0],
      midtones: [0, 0, 0],
      highlights: [0, 0, 0],
      preserveLuminosity: true,
    }))
    .with('blackWhite', () => ({
      type: 'blackWhite',
      weights: [40, 60, 40, 60, 20, 80],
      tint: null,
    }))
    .with('photoFilter', () => ({
      type: 'photoFilter',
      color: WARMING,
      density: 0.25,
      preserveLuminosity: true,
    }))
    .with('channelMixer', () => ({
      type: 'channelMixer',
      monochrome: false,
      rows: [
        [100, 0, 0, 0],
        [0, 100, 0, 0],
        [0, 0, 100, 0],
      ],
    }))
    .with('invert', () => ({ type: 'invert' }))
    .with('posterize', () => ({ type: 'posterize', levels: 4 }))
    .with('threshold', () => ({ type: 'threshold', level: 128 }))
    .with('gradientMap', () => ({
      type: 'gradientMap',
      gradient: twoColorGradient(BLACK, WHITE, 'Black, White'),
      dither: false,
      reverse: false,
    }))
    .exhaustive();
}

/** Whether the editor has controls for an adjustment's kind. */
export const isEditable = (a: Adjustment): a is Extract<
  Adjustment,
  { type: EditableAdjustment }
> => (ADJUSTMENT_TYPES as readonly string[]).includes(a.type);

/**
 * A curve's points sorted by input, without two at the same input, with
 * the ends kept (`[input, output]`, 8-bit).
 */
export function normalizeCurve(points: [number, number][]): [number, number][] {
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  const byInput = new Map<number, number>();
  for (const [i, o] of points) byInput.set(clamp(i), clamp(o));
  const sorted = [...byInput.entries()].sort((a, b) => a[0] - b[0]);
  return sorted.length >= 2
    ? sorted
    : [
        [0, 0],
        [255, 255],
      ];
}
