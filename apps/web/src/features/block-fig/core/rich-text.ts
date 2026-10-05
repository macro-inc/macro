/**
 * Character styles of a text layer as the editor sees them: the style a
 * character is drawn in (its run over the layer's style), what a range of
 * characters shares ("Mixed" where it differs), and the patches Figma's
 * ⌘B, ⌘I, and ⌘U make to a range.
 */

import type {
  FontStatus,
  PaintInfo,
  TextInfo,
  TextRun,
} from '@core/fig-engine/types';
import { MIXED, type Mixed } from './mixed';
import { parseStyle, styleName } from './type';

/** The style one character is laid out in. */
export interface CharStyle {
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
  decoration: string;
  letterSpacing: [number, string] | null;
  lineHeight: [number, string] | null;
  case: string;
  /** Its own paints; `null` when it shows the layer's. */
  fills: PaintInfo[] | null;
  fontStatus: FontStatus;
}

/** The fields a range of characters may share. */
export type RangeStyle = { [K in keyof CharStyle]: Mixed<CharStyle[K]> };

const runOf = (text: TextInfo, unit: number): TextRun | undefined => {
  const id = text.styleIds[unit] ?? 0;
  return id === 0 ? undefined : text.runs.find((r) => r.id === id);
};

/** The style character `unit` (a UTF-16 index) is drawn in. */
export function styleAt(text: TextInfo, unit: number): CharStyle {
  const run = runOf(text, unit);
  return {
    fontFamily: run?.fontFamily ?? text.fontFamily ?? 'Inter',
    fontStyle: run?.fontStyle ?? text.fontStyle ?? 'Regular',
    fontSize: run?.fontSize ?? text.fontSize ?? 12,
    decoration: run?.decoration ?? text.decoration ?? 'NONE',
    letterSpacing: run?.letterSpacing ?? text.letterSpacing,
    lineHeight: run?.lineHeight ?? text.lineHeight,
    case: run?.case ?? text.case ?? 'ORIGINAL',
    fills: run?.fills ?? null,
    fontStatus: run?.fontStatus ?? text.fontStatus,
  };
}

const KEYS: (keyof CharStyle)[] = [
  'fontFamily',
  'fontStyle',
  'fontSize',
  'decoration',
  'letterSpacing',
  'lineHeight',
  'case',
  'fills',
  'fontStatus',
];

/**
 * What characters `start..end` share. An empty range (a caret) takes the
 * style of the character before it, which typing continues.
 */
export function rangeStyle(
  text: TextInfo,
  start: number,
  end: number
): RangeStyle {
  const [a, b] = start <= end ? [start, end] : [end, start];
  if (a === b) return styleAt(text, Math.max(0, a - 1));
  const first = styleAt(text, a);
  const out = { ...first } as RangeStyle;
  for (let unit = a + 1; unit < b; unit++) {
    const s = styleAt(text, unit);
    for (const key of KEYS) {
      if (
        out[key] !== MIXED &&
        JSON.stringify(out[key]) !== JSON.stringify(s[key])
      ) {
        (out as Record<string, unknown>)[key] = MIXED;
      }
    }
  }
  return out;
}

/** Type fields the panel shows "Mixed" for. */
export type MixedTextField =
  | 'fontFamily'
  | 'fontStyle'
  | 'fontSize'
  | 'decoration'
  | 'letterSpacing'
  | 'lineHeight'
  | 'case';

/**
 * The layer's text info as the Type section shows it for a range: shared
 * values in place of the layer's, and which ones are mixed.
 */
export function textInfoForRange(
  text: TextInfo,
  start: number,
  end: number
): { text: TextInfo; mixed: Set<MixedTextField> } {
  const r = rangeStyle(text, start, end);
  const mixed = new Set<MixedTextField>();
  const pick = <K extends MixedTextField>(key: K): CharStyle[K] | null => {
    const v = r[key];
    if (v === MIXED) {
      mixed.add(key);
      return null;
    }
    return v as CharStyle[K];
  };
  return {
    text: {
      ...text,
      fontFamily: pick('fontFamily'),
      fontStyle: pick('fontStyle'),
      fontSize: pick('fontSize'),
      decoration: pick('decoration'),
      letterSpacing: pick('letterSpacing'),
      lineHeight: pick('lineHeight'),
      case: pick('case'),
      fontStatus: r.fontStatus === MIXED ? 'STYLE_MISSING' : r.fontStatus,
    },
    mixed,
  };
}

/** The paints a range shows: its own, `null` for the layer's, or mixed. */
export function rangeFills(
  text: TextInfo,
  start: number,
  end: number
): Mixed<PaintInfo[] | null> {
  return rangeStyle(text, start, end).fills;
}

/** The family and style of the layer and of each of its runs. */
export function textFonts(text: TextInfo): { family: string; style: string }[] {
  const base = {
    family: text.fontFamily ?? 'Inter',
    style: text.fontStyle ?? 'Regular',
  };
  const all = [
    base,
    ...text.runs.map((r) => ({
      family: r.fontFamily ?? base.family,
      style: r.fontStyle ?? base.style,
    })),
  ];
  return all.filter(
    (f, k) =>
      all.findIndex((g) => g.family === f.family && g.style === f.style) === k
  );
}

/** ⌘B: bold unless every character is bold already, keeping italics. */
export function toggleBold(r: RangeStyle): { fontStyle: string } {
  const style = r.fontStyle === MIXED ? null : parseStyle(r.fontStyle);
  const bold = style !== null && style.weight >= 700;
  return { fontStyle: styleName(bold ? 400 : 700, style?.italic ?? false) };
}

/** ⌘I: italic unless every character is italic already, keeping weight. */
export function toggleItalic(r: RangeStyle): { fontStyle: string } {
  const style = r.fontStyle === MIXED ? null : parseStyle(r.fontStyle);
  const italic = style !== null && style.italic;
  return { fontStyle: styleName(style?.weight ?? 400, !italic) };
}

/** ⌘U: underline unless every character is underlined already. */
export function toggleUnderline(r: RangeStyle): {
  textDecoration: 'NONE' | 'UNDERLINE';
} {
  return {
    textDecoration: r.decoration === 'UNDERLINE' ? 'NONE' : 'UNDERLINE',
  };
}
