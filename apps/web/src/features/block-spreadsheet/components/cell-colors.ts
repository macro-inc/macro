/** Templates paint cells white as paper, to hide gridlines. On a dark theme a
 * literal white would show as white blocks, so white follows the grid's own
 * background and is otherwise treated as no fill. */
function isPaper(fill?: string): boolean {
  return !!fill && /^#f{6}$/i.test(fill);
}

/** The CSS background of a cell fill. */
export function cellBackground(fill?: string): string | undefined {
  if (!fill) return undefined;
  return isPaper(fill) ? 'var(--color-surface)' : fill;
}

/** Excel's default black follows the app foreground on an unfilled cell, and so
 * do the darker grays templates use for secondary text ("Text 1, lighter 35%"):
 * they keep their strength against the app background, which on a light theme
 * renders the workbook's own gray. Explicit fill/text pairs remain workbook
 * colors, including on export: these helpers only choose CSS values and never
 * modify the stored cell style.
 */
export function cellForeground(
  color?: string,
  fill?: string
): string | undefined {
  if (!fill || isPaper(fill)) {
    if (!color) return undefined;
    const strength = inkStrength(color);
    if (strength === undefined) return color;
    return strength === 100
      ? 'var(--color-ink)'
      : `color-mix(in srgb, var(--color-ink) ${strength}%, transparent)`;
  }
  if (color) return color;

  // A fill is a literal workbook color rather than a themed surface. Choose
  // the higher-contrast default so both pale fills and dark headers stay legible.
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(fill.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

/** How strongly a neutral black or dark gray darkens white, as a percentage. */
function inkStrength(color: string): number | undefined {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(color.slice(offset, offset + 2), 16)
  );
  const lightest = Math.max(...channels);
  // Lighter grays stay legible on both themes and keep their literal color.
  if (lightest - Math.min(...channels) > 16 || lightest > 128) return;
  const average = (channels[0] + channels[1] + channels[2]) / 3;
  return Math.round(100 - (average / 255) * 100);
}

export function cellBorderColor(color?: string, fill?: string): string {
  return cellForeground(color, fill) ?? 'var(--color-ink)';
}

/** An Excel data bar: a gradient fades toward the bar's end, which is the
 * left for negative values. */
export function dataBarBackground(bar: {
  value: number;
  axis: number;
  color: string;
  negativeColor: string;
  gradient: boolean;
}): string {
  const negative = bar.value < bar.axis;
  const color = negative ? bar.negativeColor : bar.color;
  if (!bar.gradient) return color;
  const faded = `color-mix(in srgb, ${color} 25%, transparent)`;
  return `linear-gradient(to ${negative ? 'left' : 'right'}, ${color}, ${faded})`;
}
