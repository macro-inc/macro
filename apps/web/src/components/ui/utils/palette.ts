/** Macro's authored color palette, in stable hashing order. */
export const PALETTE_COLORS = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'violet',
  'purple',
  'pink',
] as const;

/** A color from Macro's authored palette. */
export type PaletteColor = (typeof PALETTE_COLORS)[number];

/** A palette that always contains at least one color. */
export type NonEmptyPalette<Color extends string = string> = readonly [
  Color,
  ...Color[],
];

/** Options for selecting a stable color for a string. */
export interface GetHashedPaletteColorOptions<Color extends string> {
  /** Override the authored palette for a specific use case. */
  palette: NonEmptyPalette<Color>;
}

export function getHashedPaletteColor(value: string): PaletteColor;
export function getHashedPaletteColor<const Color extends string>(
  value: string,
  options: GetHashedPaletteColorOptions<Color>
): Color;

/** Select a deterministic palette entry for a string. */
export function getHashedPaletteColor(
  value: string,
  options?: GetHashedPaletteColorOptions<string>
): string {
  const palette = options?.palette ?? PALETTE_COLORS;
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return palette[(hash >>> 0) % palette.length];
}
