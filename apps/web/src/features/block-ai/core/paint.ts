/**
 * Fills and strokes as the editor shows and sets them: colors in the
 * space a file gave them (RGB, gray, CMYK, spot) shown as sRGB hex, solid
 * paints from typed hex, gradients as swatches, and the default fill and
 * stroke new objects get, as Illustrator's toolbar holds them.
 */

import type { Matrix, Point } from './geometry';

export type Color =
  | { space: 'gray'; g: number }
  | { space: 'rgb'; r: number; g: number; b: number }
  | { space: 'cmyk'; c: number; m: number; y: number; k: number }
  | {
      space: 'spot';
      name: string;
      tint: number;
      rgb: [number, number, number];
    };

interface GradientStop {
  offset: number;
  color: Color;
  opacity: number;
}

interface Gradient {
  transform: Matrix;
  radial: boolean;
  start: Point;
  end: Point;
  startRadius: number;
  endRadius: number;
  stops: GradientStop[];
  extend: [boolean, boolean];
}

export type Paint =
  | { type: 'solid'; color: Color }
  | { type: 'gradient'; gradient: Gradient };

export type LineCap = 'butt' | 'round' | 'square';
export type LineJoin = 'miter' | 'round' | 'bevel';

export interface Stroke {
  paint: Paint;
  width: number;
  cap: LineCap;
  join: LineJoin;
  miterLimit: number;
  dash: number[];
  dashOffset: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A color as straight sRGB, `0..=1`. */
function toRgb(c: Color): [number, number, number] {
  switch (c.space) {
    case 'gray':
      return [c.g, c.g, c.g];
    case 'rgb':
      return [c.r, c.g, c.b];
    case 'cmyk':
      return [
        (1 - c.c) * (1 - c.k),
        (1 - c.m) * (1 - c.k),
        (1 - c.y) * (1 - c.k),
      ];
    case 'spot':
      return c.rgb;
  }
}

/** `RRGGBB` of a color's sRGB. */
export function colorHex(c: Color): string {
  return toRgb(c)
    .map((v) =>
      Math.round(clamp01(v) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
    .toUpperCase();
}

/** How a color is described beside its swatch. */
export function colorLabel(c: Color): string {
  const pct = (v: number) => Math.round(clamp01(v) * 100);
  switch (c.space) {
    case 'gray':
      return `Gray ${100 - pct(c.g)}%`;
    case 'rgb':
      return `#${colorHex(c)}`;
    case 'cmyk':
      return `CMYK ${pct(c.c)}/${pct(c.m)}/${pct(c.y)}/${pct(c.k)}`;
    case 'spot':
      return `${c.name} ${pct(c.tint)}%`;
  }
}

/** A solid RGB paint from `RRGGBB` hex (`#` and 3 digits allowed). */
export function solidPaint(hex: string): Paint | undefined {
  let t = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(t)) t = [...t].map((ch) => ch + ch).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(t)) return undefined;
  const n = (i: number) => Number.parseInt(t.slice(i, i + 2), 16) / 255;
  return { type: 'solid', color: { space: 'rgb', r: n(0), g: n(2), b: n(4) } };
}

/** The hex a paint shows as: its color, or a gradient's first stop. */
export function paintHex(p: Paint | null | undefined): string | undefined {
  if (!p) return undefined;
  if (p.type === 'solid') return colorHex(p.color);
  const first = p.gradient.stops[0];
  return first ? colorHex(first.color) : undefined;
}

/** CSS that previews a paint on a swatch (`transparent` for none). */
export function paintCss(p: Paint | null | undefined): string {
  if (!p) return 'transparent';
  if (p.type === 'solid') return `#${colorHex(p.color)}`;
  const stops = [...p.gradient.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((s) => {
      const [r, g, b] = toRgb(s.color).map((v) => Math.round(clamp01(v) * 255));
      return `rgba(${r}, ${g}, ${b}, ${clamp01(s.opacity)}) ${Math.round(s.offset * 100)}%`;
    });
  if (stops.length === 0) return 'transparent';
  if (stops.length === 1) stops.push(stops[0]);
  return p.gradient.radial
    ? `radial-gradient(circle, ${stops.join(', ')})`
    : `linear-gradient(90deg, ${stops.join(', ')})`;
}

/** A paint's kind as the panel names it. */
export function paintKind(p: Paint | null | undefined): string {
  if (!p) return 'None';
  if (p.type === 'solid') return colorLabel(p.color);
  return p.gradient.radial ? 'Radial gradient' : 'Linear gradient';
}

export const BLACK: Paint = { type: 'solid', color: { space: 'gray', g: 0 } };
const WHITE: Paint = { type: 'solid', color: { space: 'gray', g: 1 } };

/** A solid stroke of `paint`, Illustrator's defaults otherwise. */
export function strokeOf(paint: Paint, width = 1): Stroke {
  return {
    paint,
    width,
    cap: 'butt',
    join: 'miter',
    miterLimit: 10,
    dash: [],
    dashOffset: 0,
  };
}

/** Illustrator's default appearance: a white fill and a 1 pt black stroke. */
export interface Appearance {
  fill: Paint | null;
  stroke: Stroke | null;
}

export const DEFAULT_APPEARANCE: Appearance = {
  fill: WHITE,
  stroke: strokeOf(BLACK, 1),
};

/** Fill and stroke swapped (⇧X): the stroke keeps its settings. */
export function swapAppearance(a: Appearance): Appearance {
  return {
    fill: a.stroke?.paint ?? null,
    stroke: a.fill
      ? { ...(a.stroke ?? strokeOf(a.fill)), paint: a.fill }
      : null,
  };
}

/** Dash lengths typed as `4, 2` (empty or `none`: solid). */
export function parseDash(text: string): number[] | undefined {
  const t = text.trim().toLowerCase();
  if (t === '' || t === 'none' || t === '0') return [];
  const parts = t
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  return parts.every((n) => n === 0) ? [] : parts;
}

export const formatDash = (dash: readonly number[]) =>
  dash.length === 0 ? 'None' : dash.join(', ');
