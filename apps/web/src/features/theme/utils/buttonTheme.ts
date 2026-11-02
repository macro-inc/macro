import Color from 'colorjs.io';
import type { ResolvedThemeColors } from './resolvedThemeColors';

const SRGB_LINEAR_THRESHOLD = 0.04045;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;
const SRGB_EXPONENT = 2.4;
const DARK_INK_LUMINANCE_THRESHOLD = 0.179;
const LUMINANCE_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;
const BLACK = 'oklch(0 0 0)';
const WHITE = 'oklch(1 0 0)';

function linearize(channel: number): number {
  const clamped = Math.max(0, Math.min(1, channel));
  if (clamped <= SRGB_LINEAR_THRESHOLD) return clamped / SRGB_LINEAR_DIVISOR;
  return ((clamped + SRGB_OFFSET) / SRGB_SCALE) ** SRGB_EXPONENT;
}

/** Choose accent contrast only. CSS owns all other Button materials and states. */
export function buttonAccentVars(
  colors: ResolvedThemeColors
): Record<string, string> {
  const accent = colors.accent;
  const rgb = new Color('oklch', [accent.l, accent.c, accent.h], accent.alpha)
    .toGamut({ space: 'srgb' })
    .to('srgb');
  const luminance = rgb.coords.reduce(
    (sum, channel, index) =>
      sum + linearize(channel) * LUMINANCE_WEIGHTS[index],
    0
  );
  const useDarkInk = luminance > DARK_INK_LUMINANCE_THRESHOLD;

  return {
    '--button-accent-ink': useDarkInk ? BLACK : WHITE,
    '--button-accent-state-mix': useDarkInk ? WHITE : BLACK,
  };
}
