/**
 * Colors as the editor shows and types them: the engine's straight sRGB
 * (`0..=1`) as hex, 8-bit RGB, and HSB (Photoshop's color picker model).
 */

import type { Rgb } from '@core/psd-engine/types';

export const BLACK: Rgb = { r: 0, g: 0, b: 0 };
export const WHITE: Rgb = { r: 1, g: 1, b: 1 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const byte = (v: number) => Math.round(clamp01(v) * 255);

/** 8-bit components. */
export function toBytes(c: Rgb): [number, number, number] {
  return [byte(c.r), byte(c.g), byte(c.b)];
}

export function fromBytes(r: number, g: number, b: number): Rgb {
  return { r: clamp01(r / 255), g: clamp01(g / 255), b: clamp01(b / 255) };
}

/** `RRGGBB` (upper case, no `#`). */
export function toHex(c: Rgb): string {
  return toBytes(c)
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** Parses `#rgb`, `rgb`, `#rrggbb`, or `rrggbb`; undefined otherwise. */
export function parseHex(text: string): Rgb | undefined {
  let s = text.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s))
    s = s
      .split('')
      .map((c) => c + c)
      .join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) return undefined;
  const v = Number.parseInt(s, 16);
  return fromBytes((v >> 16) & 255, (v >> 8) & 255, v & 255);
}

/** A CSS color. */
export function css(c: Rgb, alpha = 1): string {
  const [r, g, b] = toBytes(c);
  return alpha >= 1
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Hue (degrees), saturation and brightness (`0..=1`). */
export interface Hsb {
  h: number;
  s: number;
  b: number;
}

export function toHsb(c: Rgb): Hsb {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const d = max - min;
  let h = 0;
  if (d > 1e-9) {
    if (max === c.r) h = ((c.g - c.b) / d) % 6;
    else if (max === c.g) h = (c.b - c.r) / d + 2;
    else h = (c.r - c.g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max <= 1e-9 ? 0 : d / max, b: max };
}

export function fromHsb(hsb: Hsb): Rgb {
  const h = (((hsb.h % 360) + 360) % 360) / 60;
  const s = clamp01(hsb.s);
  const v = clamp01(hsb.b);
  const c = v * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 1
      ? [c, x, 0]
      : h < 2
        ? [x, c, 0]
        : h < 3
          ? [0, c, x]
          : h < 4
            ? [0, x, c]
            : h < 5
              ? [x, 0, c]
              : [c, 0, x];
  return { r: r + m, g: g + m, b: b + m };
}

/** Whether two colors are the same at 8 bits. */
export function sameColor(a: Rgb, b: Rgb): boolean {
  const [ar, ag, ab] = toBytes(a);
  const [br, bg, bb] = toBytes(b);
  return ar === br && ag === bg && ab === bb;
}

/** Rec. 601 luma, `0..=1`. */
export function luma(c: Rgb): number {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}
