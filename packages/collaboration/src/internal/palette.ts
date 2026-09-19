const palette = [
  'red',
  'orange',
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

/** Pick a collaboration cursor color from Macro's shared accent palette. */
export function getRandomPaletteColor(): string {
  return palette[Math.floor(Math.random() * palette.length)] ?? palette[0];
}
