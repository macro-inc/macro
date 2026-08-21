import Color from 'colorjs.io';

export type OklchColor = {
  l: number;
  c: number;
  h: number;
  alpha: number;
};

const DEFAULT_OKLCH: OklchColor = { l: 0, c: 0, h: 0, alpha: 1 };

const finiteNumber = (value: unknown, fallback: number): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

/** Converts potentially incomplete runtime color channels into finite values. */
export function sanitizeOklch(
  color: Partial<Record<keyof OklchColor, unknown>>,
  fallback: OklchColor = DEFAULT_OKLCH
): OklchColor {
  return {
    l: Math.max(0, Math.min(1, finiteNumber(color.l, fallback.l))),
    c: Math.max(0, finiteNumber(color.c, fallback.c)),
    h: Math.max(0, Math.min(360, finiteNumber(color.h, fallback.h))),
    alpha: Math.max(0, Math.min(1, finiteNumber(color.alpha, fallback.alpha))),
  };
}

/** Produces an OKLCH CSS color without ever serializing undefined or NaN. */
export function formatOklch(color: Partial<OklchColor>): string {
  const safe = sanitizeOklch(color);
  return `oklch(${safe.l} ${safe.c} ${safe.h}deg / ${safe.alpha})`;
}

export function validateColor(color: string): boolean {
  return CSS.supports('color', color);
}

export function getOklch(cssColor: string): OklchColor {
  const color = new Color(cssColor);
  const convert = color.to('oklch');

  return sanitizeOklch({
    l: convert.coords[0],
    c: convert.coords[1],
    h: convert.coords[2],
    alpha: convert.alpha,
  });
}

/** Parses a CSS color without allowing invalid or unresolved editor state to
 * escape into rendering. CSS variables and mixes should be resolved by the
 * caller first; malformed values simply retain the supplied finite fallback. */
export function tryGetOklch(
  cssColor: unknown,
  fallback: OklchColor = DEFAULT_OKLCH
): OklchColor {
  const safeFallback = sanitizeOklch(fallback);
  if (typeof cssColor !== 'string' || cssColor.trim().length === 0) {
    return safeFallback;
  }

  try {
    return getOklch(cssColor);
  } catch {
    return safeFallback;
  }
}

export function convertOklchTo(
  l: number,
  c: number,
  h: number,
  type: string,
  alpha = 1
): string {
  try {
    const safe = sanitizeOklch({ l, c, h, alpha });
    if (safe.c < 1e-10) safe.c = 0;
    const color = new Color('oklch', [safe.l, safe.c, safe.h], safe.alpha);

    switch (type) {
      case 'hex':
        return color.to('srgb').toString({ precision: 4, format: 'hex' });
      case 'rgb':
        return color.to('srgb').toString({ precision: 4, format: 'rgb' });
      case 'oklab':
        return color.to('oklab').toString({ precision: 4 });
      case 'hsl':
        return color.to('hsl').toString({ precision: 4 });
      case 'oklch':
        return color.toString({ precision: 4 });
      default:
        return color.to('srgb').toString({ format: 'hex' });
    }
  } catch (error) {
    console.error(error);
    return '#000000';
  }
}
