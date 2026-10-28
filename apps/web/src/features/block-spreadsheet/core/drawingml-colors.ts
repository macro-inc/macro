import { withLightness } from './xlsx-stylesheet';

/** DrawingML colors: theme colors with their modifiers, as #RRGGBB. */

export const SCHEME_COLORS: Record<string, number> = {
  bg1: 0,
  lt1: 0,
  tx1: 1,
  dk1: 1,
  bg2: 2,
  lt2: 2,
  tx2: 3,
  dk2: 3,
  accent1: 4,
  accent2: 5,
  accent3: 6,
  accent4: 7,
  accent5: 8,
  accent6: 9,
  hlink: 10,
  folHlink: 11,
};
/** Office's default theme accents, for workbooks without a theme. */
export const DEFAULT_ACCENTS = [
  '4472C4',
  'ED7D31',
  'A5A5A5',
  'FFC000',
  '5B9BD5',
  '70AD47',
];

/** A DrawingML color being read: its base and the modifiers that follow. */
export type PendingColor = { hex?: string; modifiers: [string, number][] };

export function finishColor(color: PendingColor): string | undefined {
  let hex = color.hex;
  if (!hex) return;
  let multiply = 1;
  let offset = 0;
  for (const [name, value] of color.modifiers) {
    const amount = value / 100_000;
    if (name === 'lumMod') multiply *= amount;
    else if (name === 'lumOff') offset += amount;
    else if (name === 'shade' || name === 'tint') {
      const channels = [0, 2, 4].map(
        (index) => Number.parseInt(hex!.slice(index, index + 2), 16) / 255
      );
      hex = channels
        .map((channel) =>
          Math.round(
            (name === 'shade'
              ? channel * amount
              : channel * amount + 1 - amount) * 255
          )
            .toString(16)
            .padStart(2, '0')
        )
        .join('')
        .toUpperCase();
    }
  }
  if (multiply !== 1 || offset)
    hex = withLightness(hex, (lightness) => lightness * multiply + offset);
  return `#${hex.toUpperCase()}`;
}

/** Office's default theme colors, by `SCHEME_COLORS` index. */
export const DEFAULT_THEME = [
  'FFFFFF',
  '000000',
  'E7E6E6',
  '44546A',
  ...DEFAULT_ACCENTS,
  '0563C1',
  '954F72',
];

/** A scheme color of the theme as RRGGBB, Office's when it has none. */
export function schemeColor(
  theme: (string | undefined)[],
  name: string
): string | undefined {
  const index = SCHEME_COLORS[name];
  if (index === undefined) return;
  return theme[index] ?? DEFAULT_THEME[index];
}

/** The theme's accent colors as #RRGGBB, Office's when it has none. */
export function themeAccents(theme: (string | undefined)[]): string[] {
  return DEFAULT_ACCENTS.map(
    (fallback, index) => `#${theme[4 + index] ?? fallback}`
  );
}

/**
 * DrawingML with its theme colors replaced by the colors they were, so it
 * looks the same whatever theme an export carries. `prefix` is the
 * DrawingML namespace's prefix; scheme colors in `keep` stay as they are.
 */
export function resolveSchemeColors(
  source: string,
  prefix: string,
  theme: (string | undefined)[],
  keep: ReadonlySet<string> = new Set()
): string {
  return source.replace(
    new RegExp(
      `<${prefix}:schemeClr val="(\\w+)"\\s*(?:/>|>([\\s\\S]*?)</${prefix}:schemeClr>)`,
      'g'
    ),
    (element: string, scheme: string, modifiers: string | undefined) => {
      const color = keep.has(scheme) ? undefined : schemeColor(theme, scheme);
      if (!color) return element;
      return modifiers === undefined
        ? `<${prefix}:srgbClr val="${color}"/>`
        : `<${prefix}:srgbClr val="${color}">${modifiers}</${prefix}:srgbClr>`;
    }
  );
}
