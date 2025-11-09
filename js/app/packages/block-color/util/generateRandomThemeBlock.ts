import type {
  ColorBlock,
  ColorColumn,
  Swatch,
} from '@block-color/type/ColorBlock';

function rand(): number {
  return Math.random();
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function mod360(h: number): number {
  let x = h % 360;
  if (x < 0) x += 360;
  return x;
}

function sigmoid(x: number, b: number): number {
  const s = 1 / (1 + Math.pow(Math.E, b * x));
  return clamp(s, 0, 1);
}

function parabola(t: number): number {
  return Math.pow(t, 4) / 20;
}

function toSwatch(l: number, c: number, h: number): Swatch {
  const L = clamp(l, 0, 1);
  const C = clamp(c, 0, 0.4);
  const H = mod360(h);
  return {
    color: `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(3)})`,
  };
}

/**
 * Generate a ColorBlock matching the Theme spec layout:
 * - 3 columns (Accent, Contrast, Surface)
 * - 5 rows each
 * - Accent rows 2..5 vary H only
 * - Contrast rows 2..5 vary L only (C and H locked)
 * - Surface rows 2..5 vary L only (C and H locked)
 */
export function generateRandomThemeBlock(): ColorBlock {
  const hue = rand() * 360;
  const polarity = rand() > 0.5 ? 1 : -1;
  const b = polarity * (rand() * 9 + 1);

  // Accent
  const accentL = 0.5 + rand() * 0.5;
  const accentC = 0.25 + rand() * 0.12;
  const accentH = hue;
  const accentHOffsets = [72, -72, 144, -144];
  const accentColumn: ColorColumn = {
    colors: [
      toSwatch(accentL, accentC, accentH),
      ...accentHOffsets.map((d) => toSwatch(accentL, accentC, accentH + d)),
    ],
  };

  // Contrast
  const contrastC = parabola(rand());
  const contrastH = hue; // keep consistent hue family
  const contrastL = sigmoid(0.5, b);
  const contrastLs = [0.4, 0.3, 0.2, 0.1].map((x) => sigmoid(x, b));
  const contrastColumn: ColorColumn = {
    colors: [
      toSwatch(contrastL, contrastC, contrastH),
      ...contrastLs.map((L) => toSwatch(L, contrastC, contrastH)),
    ],
  };

  // Surface
  const surfaceC = parabola(rand());
  const surfaceH = hue;
  const surfaceL = sigmoid(-0.5, b);
  const surfaceLs = [-0.4, -0.3, -0.2, -0.1].map((x) => sigmoid(x, b));
  const surfaceColumn: ColorColumn = {
    colors: [
      toSwatch(surfaceL, surfaceC, surfaceH),
      ...surfaceLs.map((L) => toSwatch(L, surfaceC, surfaceH)),
    ],
  };

  const block: ColorBlock = {
    name: 'Random Theme',
    columns: [accentColumn, contrastColumn, surfaceColumn],
  };

  return block;
}
