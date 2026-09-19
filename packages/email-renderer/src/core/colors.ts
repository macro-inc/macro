export type RGBA = { r: number; g: number; b: number; a: number };
export type OKLCH = { l: number; c: number; h: number; a?: number };
const CONTRAST_THRESHOLD = 0.5;
export function rgbaToOklch(rgba: RGBA | null): OKLCH | null {
  if (!rgba) return null;
  const { r, g, b, a } = rgba;
  function inverseGammaCorrection(component: number): number {
    return component <= 0.04045
      ? component / 12.92
      : Math.pow((component + 0.055) / 1.055, 2.4);
  }

  const linearR = inverseGammaCorrection(r);
  const linearG = inverseGammaCorrection(g);
  const linearB = inverseGammaCorrection(b);

  const okLabLCubed =
    linearR * 0.4122214708 + linearG * 0.5363325363 + linearB * 0.0514459929;
  const okLabMCubed =
    linearR * 0.2119034982 + linearG * 0.6806995451 + linearB * 0.1073969566;
  const okLabSCubed =
    linearR * 0.0883024619 + linearG * 0.2817188376 + linearB * 0.6299787005;

  const okLabL = Math.cbrt(okLabLCubed);
  const okLabM = Math.cbrt(okLabMCubed);
  const okLabS = Math.cbrt(okLabSCubed);

  const lightness =
    okLabL * 0.2104542553 + okLabM * 0.793617785 - okLabS * 0.0040720468;
  const a_ =
    okLabL * 1.9779984951 - okLabM * 2.428592205 + okLabS * 0.4505937099;
  const b_ =
    okLabL * 0.0259040371 + okLabM * 0.7827717662 - okLabS * 0.808675766;

  const chroma = Math.sqrt(a_ * a_ + b_ * b_);
  const hueInRadians = Math.atan2(b_, a_);
  const hueInDegrees = (hueInRadians * 180) / Math.PI;

  return {
    l: lightness,
    c: chroma,
    h: hueInDegrees < 0 ? hueInDegrees + 360 : hueInDegrees,
    a: a,
  };
}

// parses the result of getComputedStyle().color
export function parseRGBA(color: string): RGBA | null {
  if (!color) return null;
  const s = color.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const m = s.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/
  );
  if (m) {
    const r = parseFloat(m[1]);
    const g = parseFloat(m[2]);
    const b = parseFloat(m[3]);
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    return { r, g, b, a };
  }
  return null;
}

export function normalizeRGBA(rgba: RGBA | null) {
  if (!rgba) return null;
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  return {
    r: clamp01(rgba.r / 255),
    g: clamp01(rgba.g / 255),
    b: clamp01(rgba.b / 255),
    a: rgba.a,
  };
}

export function findClosestContrastingColor(fg: OKLCH, bgL: number): OKLCH {
  const dir = fg.l > bgL ? 1 : -1;
  const candidate = bgL + dir * CONTRAST_THRESHOLD;
  const value =
    candidate >= 0 && candidate <= 1
      ? candidate
      : bgL - dir * CONTRAST_THRESHOLD;

  return { l: value, c: fg.c, h: fg.h, a: fg.a ?? 1 };
}
