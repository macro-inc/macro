/**
 * Colors offered by the editor: the deck's theme colors (stored as theme
 * references, so they follow the theme) and PowerPoint's standard colors.
 */

export interface Swatch {
  /** Value sent to the engine: a theme slot name or `RRGGBB`. */
  value: string;
  /** Display color. */
  css: string;
  label: string;
}

const THEME_LABELS: Record<string, string> = {
  dk1: 'Text',
  lt1: 'Background',
  dk2: 'Text 2',
  lt2: 'Background 2',
  accent1: 'Accent 1',
  accent2: 'Accent 2',
  accent3: 'Accent 3',
  accent4: 'Accent 4',
  accent5: 'Accent 5',
  accent6: 'Accent 6',
};

/** Theme slots as the engine names them where text and fills refer to them. */
const THEME_VALUE: Record<string, string> = {
  dk1: 'tx1',
  lt1: 'bg1',
  dk2: 'tx2',
  lt2: 'bg2',
};

export const STANDARD_SWATCHES: Swatch[] = [
  ['C00000', 'Dark red'],
  ['FF0000', 'Red'],
  ['FFC000', 'Orange'],
  ['FFFF00', 'Yellow'],
  ['92D050', 'Light green'],
  ['00B050', 'Green'],
  ['00B0F0', 'Light blue'],
  ['0070C0', 'Blue'],
  ['002060', 'Dark blue'],
  ['7030A0', 'Purple'],
].map(([value, label]) => ({ value, css: `#${value}`, label }));

export function themeSwatches(themeColors: [string, string][]): Swatch[] {
  return themeColors
    .filter(([slot]) => slot in THEME_LABELS)
    .map(([slot, css]) => ({
      value: THEME_VALUE[slot] ?? slot,
      css,
      label: THEME_LABELS[slot],
    }));
}
