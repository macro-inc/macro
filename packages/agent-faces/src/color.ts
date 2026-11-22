// Colour helpers for "#rrggbb" strings.

type Rgb = readonly [number, number, number];

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const channel = (value: number) =>
  Math.round(Math.max(0, Math.min(255, value)))
    .toString(16)
    .padStart(2, '0');

/** Blends `from` towards `to` by `amount` (0..1). */
export function mix(from: string, to: string, amount: number): string {
  const [r1, g1, b1] = rgb(from);
  const [r2, g2, b2] = rgb(to);
  return `#${channel(r1 + (r2 - r1) * amount)}${channel(g1 + (g2 - g1) * amount)}${channel(b1 + (b2 - b1) * amount)}`;
}

/** Perceived lightness, 0 (black) to 1 (white). */
export function lightness(hex: string): number {
  const [r, g, b] = rgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Rough perceptual distance between two colours (0 to about 765). */
export function distance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const redMean = (r1 + r2) / 2;
  return Math.sqrt(
    (2 + redMean / 256) * (r1 - r2) ** 2 +
      4 * (g1 - g2) ** 2 +
      (2 + (255 - redMean) / 256) * (b1 - b2) ** 2
  );
}
