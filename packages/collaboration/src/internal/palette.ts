const palette = [
  'accent-30',
  'accent-60',
  'accent-90',
  'accent-120',
  'accent-150',
  'accent-180',
  'accent-210',
  'accent-240',
  'accent-270',
  'accent-300',
  'accent-330',
] as const;

/** Pick a collaboration cursor color from Macro's shared accent palette. */
export function getRandomPaletteColor(): string {
  return palette[Math.floor(Math.random() * palette.length)] ?? palette[0];
}
