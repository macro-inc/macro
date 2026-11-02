/** A form's accent color, applied to the respond page it brands. */

/** WCAG relative luminance of one sRGB channel, 0–255. */
function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Black or white, whichever contrasts more with the `#rrggbb` accent. */
export function accentContrast(accent: string): '#000000' | '#ffffff' {
  const [red, green, blue] = [1, 3, 5].map((start) =>
    Number.parseInt(accent.slice(start, start + 2), 16)
  );
  const luminance =
    0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
  // Contrast with white is 1.05 / (L + 0.05); with black, (L + 0.05) / 0.05.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05
    ? '#ffffff'
    : '#000000';
}

/**
 * The variables `.form-branded` derives the page's accent tokens from, or
 * nothing for Macro's own accent.
 */
export function brandingStyle(
  accent: string | null
): Record<'--form-accent' | '--form-accent-contrast', string> | undefined {
  if (!accent) return undefined;
  return {
    '--form-accent': accent,
    '--form-accent-contrast': accentContrast(accent),
  };
}
