/**
 * Type settings as Figma's design panel shows and accepts them: style names
 * and weights, and line height and letter spacing in the units files store
 * (`PIXELS`, `PERCENT` of the font's own line height, `RAW` multiples of the
 * font size).
 */

import { evaluate } from './arith';
import { formatMeasure } from './measure';

export const WEIGHTS = [
  [100, 'Thin'],
  [200, 'Extra Light'],
  [300, 'Light'],
  [400, 'Regular'],
  [500, 'Medium'],
  [600, 'Semi Bold'],
  [700, 'Bold'],
  [800, 'Extra Bold'],
  [900, 'Black'],
] as const;

/** CSS weight and slant of a Figma style name ("Semi Bold Italic"). */
export function parseStyle(style: string | null | undefined): {
  weight: number;
  italic: boolean;
} {
  const s = (style ?? '').toLowerCase().replace(/[\s-]/g, '');
  const italic = s.includes('italic') || s.includes('oblique');
  let weight = 400;
  if (s.includes('thin') || s.includes('hairline')) weight = 100;
  else if (s.includes('extralight') || s.includes('ultralight')) weight = 200;
  else if (s.includes('light')) weight = 300;
  else if (s.includes('medium')) weight = 500;
  else if (s.includes('semibold') || s.includes('demibold')) weight = 600;
  else if (s.includes('extrabold') || s.includes('ultrabold')) weight = 800;
  else if (s.includes('black') || s.includes('heavy')) weight = 900;
  else if (s.includes('bold')) weight = 700;
  return { weight, italic };
}

/** The Figma style name for a weight and slant. */
export function styleName(weight: number, italic: boolean): string {
  const name =
    WEIGHTS.find(([w]) => w === weight)?.[1] ??
    WEIGHTS.reduce((a, b) =>
      Math.abs(b[0] - weight) < Math.abs(a[0] - weight) ? b : a
    )[1];
  if (!italic) return name;
  return name === 'Regular' ? 'Italic' : `${name} Italic`;
}

/** A length as the editor sends it. */
export interface Measure {
  value: number;
  unit: 'PIXELS' | 'PERCENT' | 'AUTO';
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Line height as the panel shows it: `Auto`, `150%`, or pixels. */
export function formatLineHeight(lh: [number, string] | null): string {
  if (!lh) return 'Auto';
  const [v, unit] = lh;
  if (unit === 'PIXELS') return formatMeasure(v);
  if (unit === 'RAW') return `${round(v * 100)}%`;
  return v === 100 ? 'Auto' : `${round(v)}%`;
}

/** Parses a typed line height: `auto`, `150%`, `24`, or arithmetic. */
export function parseLineHeight(text: string): Measure | null {
  const t = text.trim().toLowerCase();
  if (t === '' || t === 'auto') return { value: 0, unit: 'AUTO' };
  const percent = t.endsWith('%');
  const v = evaluate(t.replace(/%|px/g, ''));
  if (v === null || v < 0) return null;
  return { value: v, unit: percent ? 'PERCENT' : 'PIXELS' };
}

/** Letter spacing as the panel shows it: `0%`, `-2%`, or pixels. */
export function formatLetterSpacing(ls: [number, string] | null): string {
  if (!ls) return '0%';
  const [v, unit] = ls;
  return unit === 'PERCENT' ? `${round(v)}%` : formatMeasure(v);
}

/** Parses typed letter spacing: `2%`, `-1`, `0.5px`. */
export function parseLetterSpacing(text: string): Measure | null {
  const t = text.trim().toLowerCase();
  const percent = t.endsWith('%');
  const v = evaluate(t.replace(/%|px/g, '') || '0');
  if (v === null) return null;
  return { value: v, unit: percent ? 'PERCENT' : 'PIXELS' };
}

/** CSS `line-height` for an overlay drawn at `zoom`. */
export function cssLineHeight(
  lh: [number, string] | null,
  zoom: number
): string {
  if (!lh) return 'normal';
  const [v, unit] = lh;
  if (unit === 'PIXELS') return `${v * zoom}px`;
  if (unit === 'RAW') return String(v);
  return v === 100 ? 'normal' : `${(v / 100) * 1.21}`;
}
