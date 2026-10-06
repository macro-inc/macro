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

/** `#RRGGBB` → HSL (h in degrees, s and l in 0..1). */
function toHsl(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) * 60
      : max === g
        ? ((b - r) / d + 2) * 60
        : ((r - g) / d + 4) * 60;
  return [h, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)]
    .map((v) =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
    .toUpperCase();
}

/** PowerPoint's luminance modulation (`lumMod`/`lumOff`, as fractions). */
export function modulate(hex: string, lumMod: number, lumOff = 0): string {
  const [h, s, l] = toHsl(hex);
  return fromHsl(h, s, Math.max(0, Math.min(1, l * lumMod + lumOff)));
}

/** The variations PowerPoint offers under a theme color, lightest first. */
function variations(
  hex: string
): { mod: number; off: number; label: string }[] {
  const l = toHsl(hex)[2];
  if (l >= 0.99)
    return [0.95, 0.85, 0.75, 0.65, 0.5].map((mod) => ({
      mod,
      off: 0,
      label: `Darker ${Math.round((1 - mod) * 100)}%`,
    }));
  if (l <= 0.01)
    return [0.5, 0.35, 0.25, 0.15, 0.05].map((off) => ({
      mod: 1,
      off,
      label: `Lighter ${Math.round(off * 100)}%`,
    }));
  return [
    { mod: 0.2, off: 0.8, label: 'Lighter 80%' },
    { mod: 0.4, off: 0.6, label: 'Lighter 60%' },
    { mod: 0.6, off: 0.4, label: 'Lighter 40%' },
    { mod: 0.75, off: 0, label: 'Darker 25%' },
    { mod: 0.5, off: 0, label: 'Darker 50%' },
  ];
}

const GRID_ORDER = [
  'lt1',
  'dk1',
  'lt2',
  'dk2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
];

/**
 * The theme color grid PowerPoint shows: the ten theme colors on top, their
 * tints and shades in the rows below (as columns of `[base, ...variations]`).
 */
export function themeGrid(themeColors: [string, string][]): Swatch[][] {
  const bySlot = new Map(themeColors);
  return GRID_ORDER.filter((slot) => bySlot.has(slot)).map((slot) => {
    const css = bySlot.get(slot)!;
    const base: Swatch = {
      value: THEME_VALUE[slot] ?? slot,
      css,
      label: THEME_LABELS[slot],
    };
    return [
      base,
      ...variations(css).map((v) => {
        const hex = modulate(css, v.mod, v.off);
        return {
          value: hex,
          css: `#${hex}`,
          label: `${THEME_LABELS[slot]}, ${v.label}`,
        };
      }),
    ];
  });
}

/** Display color for a value sent to the engine (theme name or `RRGGBB`). */
export function swatchCss(
  value: string | undefined,
  themeColors: [string, string][]
): string | undefined {
  if (!value) return undefined;
  if (/^#?[0-9a-f]{6}$/i.test(value))
    return value.startsWith('#') ? value : `#${value}`;
  const slot =
    Object.entries(THEME_VALUE).find(([, v]) => v === value)?.[0] ?? value;
  return themeColors.find(([s]) => s === slot)?.[1];
}
