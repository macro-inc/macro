/**
 * Toolbar state from the engine's resolved text styles: whether a range is
 * bold, its font size, alignment, and so on.
 */

import type {
  EffectsOutline,
  RunStyle,
  TextLayoutInfo,
  TextPos,
} from '@core/pptx-engine/types';

export interface TextFormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** Size of the first character in the range, in points. */
  size?: number;
  color?: string;
  font?: string;
  /** Baseline shift in percent (positive = superscript). */
  baseline?: number;
  highlight?: string;
  /** Character spacing of the first character, in points. */
  spacing?: number;
  align?: string;
  bullet: boolean;
  /** Text shadow and glow of the first character. */
  effects?: EffectsOutline;
}

const EMPTY: TextFormatState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  bullet: false,
};

/** Styles of the characters in `[start, end)` (or at the caret when collapsed). */
function runsIn(
  layout: TextLayoutInfo,
  start: TextPos,
  end: TextPos
): RunStyle[] {
  const out: RunStyle[] = [];
  const collapsed =
    start.paragraph === end.paragraph && start.offset === end.offset;
  for (let p = start.paragraph; p <= end.paragraph; p++) {
    const style = layout.styles[p];
    if (!style) continue;
    const from = p === start.paragraph ? start.offset : 0;
    const to = p === end.paragraph ? end.offset : Number.POSITIVE_INFINITY;
    if (collapsed) {
      // The caret takes the formatting of the character before it.
      const before = style.runs.find((r) => r.start < from && r.end >= from);
      out.push(before ?? style.runs.find((r) => r.end > from) ?? style.end);
      continue;
    }
    const hits = style.runs.filter((r) => r.end > from && r.start < to);
    out.push(...(hits.length > 0 ? hits : [style.end]));
  }
  return out;
}

/** The formatting a toolbar shows for a range (or the whole text when `range` is null). */
export function formatState(
  layout: TextLayoutInfo | null,
  range: [TextPos, TextPos] | null
): TextFormatState {
  if (!layout || layout.styles.length === 0) return EMPTY;
  const lastPara = layout.styles.length - 1;
  const [start, end] = range ?? [
    { paragraph: 0, offset: 0 },
    { paragraph: lastPara, offset: Number.MAX_SAFE_INTEGER },
  ];
  const runs = runsIn(layout, start, end);
  if (runs.length === 0) return EMPTY;
  const all = (key: 'bold' | 'italic' | 'underline' | 'strike') =>
    runs.every((r) => r[key]);
  const paras = layout.styles.slice(start.paragraph, end.paragraph + 1);
  return {
    bold: all('bold'),
    italic: all('italic'),
    underline: all('underline'),
    strike: all('strike'),
    size: runs[0].size,
    color: runs[0].color,
    font: runs[0].font,
    baseline: runs[0].baseline,
    highlight: runs[0].highlight,
    spacing: runs[0].spacing,
    effects: runs[0].effects,
    align: paras[0]?.align,
    bullet: paras.length > 0 && paras.every((p) => p.bullet),
  };
}

/** PowerPoint's font size steps. */
const FONT_SIZES = [
  8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60,
  66, 72, 80, 88, 96,
];

/** The next size up or down from `size`. */
export function stepFontSize(size: number, direction: 1 | -1): number {
  if (direction > 0)
    return (
      FONT_SIZES.find((s) => s > size + 0.01) ??
      Math.min(4000, Math.round(size * 1.1))
    );
  const smaller = [...FONT_SIZES].reverse().find((s) => s < size - 0.01);
  return smaller ?? Math.max(1, Math.round(size * 0.9));
}

/** PowerPoint's Character Spacing choices (points). */
export const CHARACTER_SPACINGS = [
  { value: -3, label: 'Very Tight' },
  { value: -1.5, label: 'Tight' },
  { value: 0, label: 'Normal' },
  { value: 3, label: 'Loose' },
  { value: 6, label: 'Very Loose' },
];
