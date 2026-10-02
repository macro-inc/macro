import Color from 'colorjs.io';
import { match } from 'ts-pattern';
import { macroDarkTheme } from '../themes/macro-dark';
import { macroLightTheme } from '../themes/macro-light';
import type { ThemeColorMode, ThemeColorTokens } from '../types/themeTypes';
import { type OklchColor, sanitizeOklch } from './colorUtil';
import { parseThemeAssignment } from './themeAssignments';

const resolvedTokens = [
  'accent',
  'surface-0',
  'surface-1',
  'surface-2',
  'edge',
  'edge-muted',
  'content-0',
  'content-1',
] as const;

export type ResolvedThemeColors = Readonly<
  Record<(typeof resolvedTokens)[number], Readonly<OklchColor>>
>;

// Bounded by content, not theme ID: editing a linked input must invalidate every
// dependent result, while revisiting a preview should require no DOM reads.
const cache = new Map<string, ResolvedThemeColors>();
const CACHE_SIZE = 32;

function toOklch(color: Color): OklchColor {
  const converted = color.to('oklch');
  return sanitizeOklch({
    l: converted.coords[0],
    c: converted.coords[1],
    h: ((converted.coords[2] % 360) + 360) % 360,
    alpha: converted.alpha,
  });
}

// CSS color-mix premultiplies rectangular coordinates, but not hue. Color.js
// 0.5's mix() gamut-maps endpoints and premultiplies hue too, so use its color
// conversion with CSS interpolation here instead.
function mixColors(
  a: Color,
  b: Color,
  amount: number,
  space: 'oklch' | 'srgb'
): Color {
  const first = a.to(space);
  const second = b.to(space);
  if (space === 'oklch') {
    if (first.coords[1] < 0.000004) first.coords[2] = Number.NaN;
    if (second.coords[1] < 0.000004) second.coords[2] = Number.NaN;
  }
  const alpha = first.alpha * amount + second.alpha * (1 - amount);
  const coords = first.coords.map((start, index) => {
    let end = second.coords[index];
    if (Number.isNaN(start)) start = end;
    if (Number.isNaN(end)) end = start;
    if (space === 'oklch' && index === 2) {
      start = ((start % 360) + 360) % 360;
      end = ((end % 360) + 360) % 360;
      const delta = end - start;
      if (delta > 180) start += 360;
      else if (delta < -180) end += 360;
      return (((start * amount + end * (1 - amount)) % 360) + 360) % 360;
    }
    return alpha === 0
      ? 0
      : (start * first.alpha * amount + end * second.alpha * (1 - amount)) /
          alpha;
  }) as [number, number, number];
  return new Color(space, coords, alpha);
}

/** Resolve authored expressions without involving the application's DOM. */
function resolveGraph(tokens: ThemeColorTokens) {
  const colors = new Map<string, Color | null>();
  const visiting = new Set<string>();
  const resolve = (token: string): Color | null => {
    if (colors.has(token)) return colors.get(token) ?? null;
    if (visiting.has(token)) return null;
    const value = tokens[token];
    if (!value) return null;
    visiting.add(token);
    let color: Color | null = null;
    try {
      color = match(parseThemeAssignment(value))
        .with({ kind: 'custom' }, ({ value }) => new Color(value))
        .with({ kind: 'linked' }, ({ token, alpha }) => {
          if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null;
          const source = resolve(token);
          if (!source) return null;
          const result = source.clone();
          result.alpha *= alpha;
          return result;
        })
        .with({ kind: 'mixed' }, ({ first, second, mix, alpha, space }) => {
          if (
            !Number.isFinite(mix) ||
            mix < 0 ||
            mix > 1 ||
            !Number.isFinite(alpha) ||
            alpha < 0 ||
            alpha > 1
          )
            return null;
          const a = resolve(first);
          const b = resolve(second);
          if (!a || !b) return null;
          const result = mixColors(a, b, mix, space ?? 'oklch');
          result.alpha *= alpha;
          return result;
        })
        .exhaustive();
    } catch {
      // Arbitrary CSS syntax is resolved by the browser fallback below.
    }
    visiting.delete(token);
    colors.set(token, color);
    return color;
  };
  return resolve;
}

/** Browser-only escape hatch for custom CSS (relative colors, calc, etc.).
 * All probes are written before reading; styles belong to a tiny independent
 * document, never to the document containing the channel or spreadsheet. */
function resolveCustomColors(
  tokens: ThemeColorTokens,
  names: readonly string[],
  mode: ThemeColorMode
): Map<string, Color> {
  const colors = new Map<string, Color>();
  if (!names.length || typeof document === 'undefined' || !document.body)
    return colors;
  const frame = document.createElement('iframe');
  frame.title = 'Theme color resolution';
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText =
    'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none;contain:strict';
  document.body.append(frame);
  try {
    const doc = frame.contentDocument;
    const view = frame.contentWindow;
    if (!doc || !view) return colors;
    const root = doc.documentElement;
    root.style.colorScheme = mode;
    root.style.setProperty('--layer-surface', 'var(--color-surface-0)');
    root.style.setProperty('--layer-inset', 'var(--color-surface-0)');
    for (const [token, value] of Object.entries(tokens)) {
      root.style.setProperty(`--color-${token}`, value);
    }
    const probes = names.map((token) => {
      const probe = doc.createElement('span');
      probe.style.color = `var(--color-${token})`;
      doc.body.append(probe);
      return { token, probe };
    });
    for (const { token, probe } of probes) {
      const style = view.getComputedStyle(probe);
      const value = style.getPropertyValue(`--color-${token}`).trim();
      if (!value || typeof CSS === 'undefined' || !CSS.supports('color', value))
        continue;
      try {
        colors.set(token, new Color(style.color));
      } catch {
        // Invalid custom colors retain the default for this theme mode.
      }
    }
    return colors;
  } finally {
    frame.remove();
  }
}

/** Concrete colors needed by non-CSS consumers. Resolve before writing live CSS. */
export function resolveThemeColors(
  authored: ThemeColorTokens,
  mode: ThemeColorMode
): ResolvedThemeColors {
  const defaults = mode === 'dark' ? macroDarkTheme : macroLightTheme;
  const tokens = { ...defaults.colorTokens, ...authored };
  const key = JSON.stringify([
    mode,
    Object.entries(tokens).sort(([a], [b]) => a.localeCompare(b)),
  ]);
  const cached = cache.get(key);
  if (cached) return cached;
  const resolve = resolveGraph(tokens);
  const missing = resolvedTokens.filter((token) => !resolve(token));
  const custom = resolveCustomColors(tokens, missing, mode);
  const fallback = resolveGraph(defaults.colorTokens);
  const result = Object.fromEntries(
    resolvedTokens.map((token) => [
      token,
      toOklch(resolve(token) ?? custom.get(token) ?? fallback(token)!),
    ])
  ) as ResolvedThemeColors;
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
