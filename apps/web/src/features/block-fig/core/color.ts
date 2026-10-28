/**
 * Colors as Figma's color picker edits them: hue, saturation, and
 * brightness (HSB) for the square and sliders, alpha, and the formats the
 * value fields show (Hex, RGB, HSL, HSB). Paints carry colors as
 * `RRGGBB` or `RRGGBBAA` hex.
 */

/** Hue in degrees (0–360); saturation, brightness, and alpha in 0–1. */
export interface Hsva {
  h: number;
  s: number;
  v: number;
  a: number;
}

/** Channels in 0–255; alpha in 0–1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'hsb';

export const COLOR_FORMATS: readonly { value: ColorFormat; label: string }[] = [
  { value: 'hex', label: 'Hex' },
  { value: 'rgb', label: 'RGB' },
  { value: 'hsl', label: 'HSL' },
  { value: 'hsb', label: 'HSB' },
];

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

const byte = (v: number) => Math.round(clamp(v, 0, 255));

/** Normalizes typed hex: `#abc`, `abc`, `AABBCC`, `AABBCC80`. */
export function normalizeHex(text: string): string | undefined {
  let t = text.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(t))
    t = t
      .split('')
      .map((c) => c + c)
      .join('');
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(t)) return t.toUpperCase();
  return undefined;
}

export function hexToRgba(hex: string): Rgba {
  const t = normalizeHex(hex) ?? '000000';
  const n = (i: number) => Number.parseInt(t.slice(i, i + 2), 16);
  return {
    r: n(0),
    g: n(2),
    b: n(4),
    a: t.length === 8 ? n(6) / 255 : 1,
  };
}

/** `RRGGBB`, with `AA` when translucent. */
export function rgbaToHex(c: Rgba): string {
  const h = (v: number) => byte(v).toString(16).padStart(2, '0');
  const a = byte(c.a * 255);
  return `${h(c.r)}${h(c.g)}${h(c.b)}${a < 255 ? h(a) : ''}`.toUpperCase();
}

export function rgbaToHsva(c: Rgba): Hsva {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a: c.a };
}

export function hsvaToRgba(c: Hsva): Rgba {
  const h = (((c.h % 360) + 360) % 360) / 60;
  const s = clamp(c.s, 0, 1);
  const v = clamp(c.v, 0, 1);
  const f = (n: number) => {
    const k = (n + h) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: f(5) * 255, g: f(3) * 255, b: f(1) * 255, a: c.a };
}

export const hexToHsva = (hex: string) => rgbaToHsva(hexToRgba(hex));
export const hsvaToHex = (c: Hsva) => rgbaToHex(hsvaToRgba(c));

/** HSB to HSL (saturation and lightness in 0–1). */
export function hsvToHsl(c: Hsva): { h: number; s: number; l: number } {
  const l = c.v * (1 - c.s / 2);
  const s = l === 0 || l === 1 ? 0 : (c.v - l) / Math.min(l, 1 - l);
  return { h: c.h, s, l };
}

export function hslToHsv(h: number, s: number, l: number): Hsva {
  const v = l + s * Math.min(l, 1 - l);
  return { h, s: v === 0 ? 0 : 2 * (1 - l / v), v, a: 1 };
}

/**
 * The value fields for a color in a format: one hex field, or three
 * numbers (RGB 0–255; hue in degrees and the rest in percent).
 */
export function formatFields(c: Hsva, format: ColorFormat): string[] {
  const pct = (v: number) => String(Math.round(v * 100));
  switch (format) {
    case 'hex':
      return [hsvaToHex({ ...c, a: 1 })];
    case 'rgb': {
      const rgb = hsvaToRgba(c);
      return [rgb.r, rgb.g, rgb.b].map((v) => String(byte(v)));
    }
    case 'hsl': {
      const hsl = hsvToHsl(c);
      return [String(Math.round(hsl.h)), pct(hsl.s), pct(hsl.l)];
    }
    case 'hsb':
      return [String(Math.round(c.h)), pct(c.s), pct(c.v)];
  }
}

/**
 * The color typed into a format's field `index` (alpha kept), or
 * undefined when the text is not a value.
 */
export function parseField(
  current: Hsva,
  format: ColorFormat,
  index: number,
  text: string
): Hsva | undefined {
  if (format === 'hex') {
    const hex = normalizeHex(text);
    if (!hex) return undefined;
    const next = hexToHsva(hex);
    // A typed alpha (RRGGBBAA) wins; plain RRGGBB keeps the current one.
    return hex.length === 8 ? next : { ...next, a: current.a };
  }
  const n = Number.parseFloat(text.replace(/[%°]/g, ''));
  if (!Number.isFinite(n)) return undefined;
  if (format === 'rgb') {
    const rgb = hsvaToRgba(current);
    const channels = [rgb.r, rgb.g, rgb.b];
    channels[index] = clamp(n, 0, 255);
    const next = rgbaToHsva({
      r: channels[0],
      g: channels[1],
      b: channels[2],
      a: current.a,
    });
    // Grays have no hue of their own: keep the one the picker shows.
    return next.s === 0 ? { ...next, h: current.h } : next;
  }
  if (format === 'hsb') {
    const values = [current.h, current.s * 100, current.v * 100];
    values[index] = index === 0 ? clamp(n, 0, 360) : clamp(n, 0, 100);
    return {
      h: values[0],
      s: values[1] / 100,
      v: values[2] / 100,
      a: current.a,
    };
  }
  const hsl = hsvToHsl(current);
  const values = [hsl.h, hsl.s * 100, hsl.l * 100];
  values[index] = index === 0 ? clamp(n, 0, 360) : clamp(n, 0, 100);
  return {
    ...hslToHsv(values[0], values[1] / 100, values[2] / 100),
    a: current.a,
  };
}

/** CSS for a hex color with its alpha. */
export function cssHex(hex: string): string {
  const c = hexToRgba(hex);
  return `rgba(${byte(c.r)}, ${byte(c.g)}, ${byte(c.b)}, ${Math.round(c.a * 1000) / 1000})`;
}
