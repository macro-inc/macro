/**
 * Design ▸ Slide Size: PowerPoint's named sizes, orientation, lengths in
 * inches or centimeters, and whether a new size needs the Maximize / Ensure
 * Fit question. Sizes are in points (72 per inch).
 */

export interface SlideSizePreset {
  id: string;
  label: string;
  /** Landscape width and height in points. */
  width: number;
  height: number;
}

/** "Slides sized for", in PowerPoint's order (its `p:sldSz` sizes). */
export const SLIDE_SIZE_PRESETS: readonly SlideSizePreset[] = [
  { id: 'screen4x3', label: 'On-screen Show (4:3)', width: 720, height: 540 },
  { id: 'letter', label: 'Letter Paper (8.5x11 in)', width: 720, height: 540 },
  {
    id: 'ledger',
    label: 'Ledger Paper (11x17 in)',
    width: 959,
    height: 719.25,
  },
  { id: 'a3', label: 'A3 Paper (297x420 mm)', width: 1008, height: 756 },
  { id: 'a4', label: 'A4 Paper (210x297 mm)', width: 780, height: 540 },
  {
    id: 'b4',
    label: 'B4 (ISO) Paper (250x353 mm)',
    width: 852.5,
    height: 639.375,
  },
  {
    id: 'b5',
    label: 'B5 (ISO) Paper (176x250 mm)',
    width: 564.5,
    height: 423.375,
  },
  { id: '35mm', label: '35mm Slides', width: 810, height: 540 },
  { id: 'overhead', label: 'Overhead', width: 720, height: 540 },
  { id: 'banner', label: 'Banner', width: 576, height: 72 },
  { id: 'screen16x9', label: 'On-screen Show (16:9)', width: 720, height: 405 },
  {
    id: 'screen16x10',
    label: 'On-screen Show (16:10)',
    width: 720,
    height: 450,
  },
  { id: 'widescreen', label: 'Widescreen', width: 960, height: 540 },
];

/** Standard (4:3) and Widescreen (16:9) of the Slide Size menu. */
export const STANDARD_SIZE = { width: 720, height: 540 };
export const WIDESCREEN_SIZE = { width: 960, height: 540 };

/** The engine's limits on a side (1 to 56 inches). */
export const MIN_SIDE_PT = 72;
export const MAX_SIDE_PT = 4032;

export type Orientation = 'portrait' | 'landscape';

export const orientationOf = (width: number, height: number): Orientation =>
  height > width ? 'portrait' : 'landscape';

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;

/** The preset a size is (either orientation), or `custom`. */
export function presetOf(width: number, height: number): string {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  return (
    SLIDE_SIZE_PRESETS.find((p) => near(p.width, long) && near(p.height, short))
      ?.id ?? 'custom'
  );
}

/** A preset's size in an orientation. */
export function presetSize(
  id: string,
  orientation: Orientation
): { width: number; height: number } | undefined {
  const p = SLIDE_SIZE_PRESETS.find((x) => x.id === id);
  if (!p) return undefined;
  return orientation === 'portrait'
    ? { width: p.height, height: p.width }
    : { width: p.width, height: p.height };
}

/**
 * What changing the size does to content: nothing (`same`), a uniform scale
 * (`proportional`: Maximize and Ensure Fit agree), or a choice (`reshape`).
 */
export function sizeChange(
  from: { width: number; height: number },
  to: { width: number; height: number }
): 'same' | 'proportional' | 'reshape' {
  if (
    Math.abs(from.width - to.width) < 0.01 &&
    Math.abs(from.height - to.height) < 0.01
  )
    return 'same';
  const ratio = (from.width / from.height) * (to.height / to.width);
  return Math.abs(ratio - 1) < 1e-3 ? 'proportional' : 'reshape';
}

export type LengthUnit = 'in' | 'cm';

/** Inches where the locale measures in them, else centimeters. */
export function unitForLocale(locale: string): LengthUnit {
  return locale === 'en' || /-(US|LR|MM)$/i.test(locale) ? 'in' : 'cm';
}

const PT_PER: Record<LengthUnit, number> = { in: 72, cm: 72 / 2.54 };

/** A length for a field: `13.333 in`, `33.87 cm`. */
export function formatLength(pt: number, unit: LengthUnit): string {
  const digits = unit === 'in' ? 3 : 2;
  const value = Number((pt / PT_PER[unit]).toFixed(digits));
  return `${value} ${unit}`;
}

/**
 * Points from a typed length (`10`, `10 in`, `10"`, `25.4 cm`); a bare number
 * is in `unit`. `undefined` when it is not a length.
 */
export function parseLength(
  text: string,
  unit: LengthUnit
): number | undefined {
  const m =
    /^\s*(\d+(?:[.,]\d*)?|[.,]\d+)\s*(in|inch|inches|"|cm|mm)?\s*$/i.exec(text);
  if (!m) return undefined;
  const value = Number.parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(value)) return undefined;
  const typed = m[2]?.toLowerCase();
  if (typed === 'mm') return (value / 10) * PT_PER.cm;
  if (typed === 'cm') return value * PT_PER.cm;
  if (typed) return value * PT_PER.in;
  return value * PT_PER[unit];
}

export const clampSide = (pt: number) =>
  Math.min(MAX_SIDE_PT, Math.max(MIN_SIDE_PT, pt));
