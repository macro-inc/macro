/**
 * Fonts for laying out a design's text: the Google Fonts catalog (bundled,
 * loaded on demand), the css2 requests for a family, the `@font-face`
 * rules Google answers with, which of a family's files (one per script
 * subset) some text needs, and matching the fonts on this computer to a
 * Figma family and style.
 */

import { parseStyle } from './type';

/** A Google Fonts family: name, category, styles, and variable axes. */
export interface GoogleFamily {
  family: string;
  category: 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace';
  /** Upright and italic weights served. */
  weights: number[];
  italics: number[];
  /** Variable axes the css2 API takes, `[tag, min, max]`. */
  axes: [string, number, number][];
}

/** Catalog rows: `[family, category, weights, italics, axes]`. */
export type CatalogRow = [string, string, string, string, string];

const CATEGORIES: Record<string, GoogleFamily['category']> = {
  s: 'sans-serif',
  r: 'serif',
  d: 'display',
  h: 'handwriting',
  m: 'monospace',
};

const weightsOf = (digits: string) =>
  [...digits].map((d) => (d === 'X' ? 1000 : Number(d) * 100));

/** Reads the bundled catalog's compact rows. */
export function parseCatalog(rows: CatalogRow[]): GoogleFamily[] {
  return rows.map(([family, category, weights, italics, axes]) => ({
    family,
    category: CATEGORIES[category] ?? 'sans-serif',
    weights: weightsOf(weights),
    italics: weightsOf(italics),
    axes: axes
      ? axes.split(',').map((a) => {
          const [tag, range] = a.split(':');
          const [min, max] = range.split('-').map(Number);
          return [tag, min, max] as [string, number, number];
        })
      : [],
  }));
}

let catalog: Promise<GoogleFamily[]> | undefined;

/** The Google Fonts families, most popular first (loaded once). */
export function googleFamilies(): Promise<GoogleFamily[]> {
  catalog ??= import('./google-fonts.json').then((m) =>
    parseCatalog(m.default as CatalogRow[])
  );
  return catalog;
}

/**
 * The css2 request for a family: its variable axes as ranges (so one file
 * per subset covers every weight), or each of its weights.
 */
export function googleCssUrl(f: GoogleFamily, text?: string): string {
  const family = encodeURIComponent(f.family).replace(/%20/g, '+');
  const italic = f.italics.length > 0;
  const ranged = f.axes.filter(([tag]) =>
    ['opsz', 'wdth', 'wght'].includes(tag)
  );
  let spec: string;
  if (ranged.some(([tag]) => tag === 'wght')) {
    const tags = [...(italic ? ['ital'] : []), ...ranged.map(([t]) => t)];
    const values = ranged.map(([, min, max]) => `${min}..${max}`).join(',');
    const tuples = italic ? [`0,${values}`, `1,${values}`] : [values];
    spec = `${tags.join(',')}@${tuples.join(';')}`;
  } else if (italic) {
    const all = [
      ...f.weights.map((w) => `0,${w}`),
      ...f.italics.map((w) => `1,${w}`),
    ];
    spec = `ital,wght@${all.join(';')}`;
  } else {
    spec = `wght@${f.weights.join(';')}`;
  }
  const query = text ? `&text=${encodeURIComponent(text)}` : '';
  return `https://fonts.googleapis.com/css2?family=${family}:${spec}${query}`;
}

/** One `@font-face` rule: a file and what it covers. */
export interface FontFaceSource {
  family: string;
  italic: boolean;
  /** Weight range (equal ends for a static file). */
  weight: [number, number];
  url: string;
  /** Code point ranges; empty means every character. */
  unicodeRange: [number, number][];
}

function parseRange(value: string): [number, number][] {
  return value
    .split(',')
    .map((part) => part.trim().replace(/^U\+/i, ''))
    .filter(Boolean)
    .map((part) => {
      if (part.includes('?')) {
        return [
          Number.parseInt(part.replace(/\?/g, '0'), 16),
          Number.parseInt(part.replace(/\?/g, 'F'), 16),
        ] as [number, number];
      }
      const [a, b] = part.split('-');
      const start = Number.parseInt(a, 16);
      return [start, b ? Number.parseInt(b, 16) : start] as [number, number];
    });
}

/** The `@font-face` rules of a stylesheet (Google's css2 answers). */
export function parseFontFaces(css: string): FontFaceSource[] {
  const faces: FontFaceSource[] = [];
  for (const block of css.match(/@font-face\s*{[^}]*}/g) ?? []) {
    const prop = (name: string) =>
      block.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1]?.trim();
    const url = block.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/)?.[1];
    if (!url) continue;
    const family = (prop('font-family') ?? '').replace(/^['"]|['"]$/g, '');
    const weights = (prop('font-weight') ?? '400')
      .split(/\s+/)
      .map(Number)
      .filter((n) => !Number.isNaN(n));
    faces.push({
      family,
      italic: /italic|oblique/.test(prop('font-style') ?? ''),
      weight: [weights[0] ?? 400, weights[1] ?? weights[0] ?? 400],
      url,
      unicodeRange: parseRange(prop('unicode-range') ?? ''),
    });
  }
  return faces;
}

const covers = (ranges: [number, number][], cp: number) =>
  ranges.length === 0 || ranges.some(([a, b]) => cp >= a && cp <= b);

/**
 * The files a style needs for `text`: faces of its slant whose weights
 * reach it (the nearest weight when none does), in the subsets that hold
 * the text's characters, Latin always.
 */
export function facesFor(
  faces: FontFaceSource[],
  style: string,
  text: string
): FontFaceSource[] {
  const { weight, italic } = parseStyle(style);
  const slanted = faces.filter((f) => f.italic === italic);
  const pool = slanted.length > 0 ? slanted : faces;
  const distance = (f: FontFaceSource) =>
    weight < f.weight[0]
      ? f.weight[0] - weight
      : weight > f.weight[1]
        ? weight - f.weight[1]
        : 0;
  const best = Math.min(...pool.map(distance));
  const matching = pool.filter((f) => distance(f) === best);
  const points = new Set<number>([0x41, 0x61]);
  for (const ch of text) points.add(ch.codePointAt(0) ?? 0);
  return matching.filter((f) =>
    [...points].some((cp) => covers(f.unicodeRange, cp))
  );
}

/** A font on this computer, as the Local Font Access API lists it. */
export interface LocalFont {
  family: string;
  style: string;
  fullName: string;
  postscriptName: string;
}

const squash = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');

/**
 * The local fonts of a Figma family, best match for `style` first: the
 * same style name, else the same weight and slant.
 */
export function localFontsFor<T extends LocalFont>(
  fonts: T[],
  family: string,
  style: string
): T[] {
  const name = squash(family);
  const own = fonts.filter((f) => squash(f.family) === name);
  const want = parseStyle(style);
  const score = (f: T) => {
    if (squash(f.style) === squash(style)) return 0;
    const got = parseStyle(f.style);
    return (
      Math.abs(got.weight - want.weight) +
      (got.italic === want.italic ? 0 : 1000)
    );
  };
  return [...own].sort((a, b) => score(a) - score(b));
}
