import { COLOR_PALETTE } from '@core/constant/color-palette';

export const TAG_COLORS = COLOR_PALETTE.map(({ color }) => color);

export const DEFAULT_TAG_COLOR: string = COLOR_PALETTE[11].color;

export const TAG_COLOR_OPTIONS = COLOR_PALETTE.map(({ color, name }) => ({
  color,
  name,
}));

export type TagColorOption = (typeof TAG_COLOR_OPTIONS)[number];

/** The palette colour an option's stored hex value is, matched without regard to case. */
export function optionColorOf(
  hex: string | null | undefined
): TagColorOption | undefined {
  const wanted = hex?.toUpperCase();
  return TAG_COLOR_OPTIONS.find((option) => option.color === wanted);
}
