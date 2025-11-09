export type Hex = `#${string}`;
export type Color = Hex | 'transparent';

export type RGB = {
  r: number;
  g: number;
  b: number;
};

export type HSL = {
  h: number;
  s: number;
  l: number;
};

export function hexToRgb(hex: Hex): RGB {
  let c = hex.replace('#', '');
  if (c.length === 3) {
    c = c
      .split('')
      .map((char) => char + char)
      .join('');
  } else if (c.length === 8) {
    c = c.substring(0, 6);
  } else if (c.length !== 6) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: parseInt(c.substring(0, 2), 16),
    g: parseInt(c.substring(2, 4), 16),
    b: parseInt(c.substring(4, 6), 16),
  };
}

export function hslToRgb(hsl: HSL): RGB {
  let { h, s, l } = hsl;
  h = (h + 360) % 360;
  s = Math.max(Math.min(s / 100, 1), 0);
  l = Math.max(Math.min(l / 100, 1), 0);

  // Chroma.
  const c = (1 - Math.abs(2 * l - 1)) * s;

  // Piecewise hue.
  const h1 = h / 60;

  // Using the temporary value (x), map r, g, and b at a particular chroma.
  const x = c * (1 - Math.abs((h1 % 2) - 1));
  let r, g, b;

  if (h1 < 1) {
    r = c;
    g = x;
    b = 0;
  } else if (h1 < 2) {
    r = x;
    g = c;
    b = 0;
  } else if (h1 < 3) {
    r = 0;
    g = c;
    b = x;
  } else if (h1 < 4) {
    r = 0;
    g = x;
    b = c;
  } else if (h1 < 5) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }

  // Apply the lightness
  const m = l - c / 2;
  r = Math.floor((r + m) * 255);
  g = Math.floor((g + m) * 255);
  b = Math.floor((b + m) * 255);
  return { r, g, b };
}

export function rgbToHsl(rgb: RGB) {
  let { r, g, b } = rgb;
  // Validate rgb.
  r = Math.min(Math.max(r / 255, 0), 1);
  g = Math.min(Math.max(g / 255, 0), 1);
  b = Math.min(Math.max(b / 255, 0), 1);

  // Min and max components let us calculate chroma.
  const xMax = Math.max(r, g, b);
  const xMin = Math.min(r, g, b);

  // Value.
  const v = xMax;

  // Chroma.
  const c = xMax - xMin;

  // Lightness.
  const l = (xMax + xMin) / 2;

  let h = 0;
  if (c === 0) {
    h = 0;
  } else if (v === r) {
    h = 60 * (0 + (g - b) / c);
  } else if (v === g) {
    h = 60 * (2 + (b - r) / c);
  } else if (v === b) {
    h = 60 * (4 + (r - g) / c);
  }

  let s = 0;
  if (l > 0 && l < 1) {
    s = (v - l) / Math.min(l, 1 - l);
  }
  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function rgbToHex(rgb: RGB): Hex {
  const { r, g, b } = rgb;
  const toHex = (c: number): string => {
    const hex = c.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
