/** Excel's default black follows the app foreground on an unfilled cell.
 * Explicit fill/text pairs remain workbook colors, including on export: these
 * helpers only choose CSS values and never modify the stored cell style.
 */
export function cellForeground(
  color?: string,
  fill?: string
): string | undefined {
  if (!color && !fill) return undefined;
  if (color && (fill || color.toLowerCase() !== '#000000')) return color;
  if (!fill) return 'var(--color-ink)';

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

export function cellBorderColor(color?: string, fill?: string): string {
  return cellForeground(color, fill) ?? 'var(--color-ink)';
}
