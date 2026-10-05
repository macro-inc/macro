/**
 * Text layers as the Type tool makes and edits them. The engine stores
 * text as Photoshop does (paragraphs end with `\r`, the last one too); the
 * editor types `\n` between paragraphs. Editing the characters keeps the
 * style runs around the change and gives each paragraph the alignment it
 * had.
 */

import type {
  Rgb,
  TextAlign,
  TextLayer,
  TextStyle,
} from '@core/psd-engine/types';
import type { Point } from './selection-math';

/** The text as the editor shows it (`\n` between paragraphs). */
export function fromPsText(text: string): string {
  return text.replace(/\r$/, '').replace(/\r/g, '\n');
}

/** The text as the engine stores it. */
export function toPsText(text: string): string {
  return `${text.replace(/\r\n?/g, '\n').replace(/\n/g, '\r')}\r`;
}

/** The default style of new text (Photoshop's, in the foreground color). */
export function defaultTextStyle(color: Rgb, size = 24): TextStyle {
  return {
    font: 'Inter-Regular',
    size,
    color,
    tracking: 0,
    leading: null,
    fauxBold: false,
    fauxItalic: false,
    underline: false,
    strikethrough: false,
    case: 'normal',
    baselineShift: 0,
    horizontalScale: 1,
    verticalScale: 1,
  };
}

/** Paragraph runs, one per paragraph of `psText`. */
function paragraphsOf(psText: string, alignAt: (index: number) => TextAlign) {
  const parts = psText.split('\r');
  // The text ends with `\r`: the last split part is empty.
  parts.pop();
  return parts.map((p, i) => ({ length: p.length + 1, align: alignAt(i) }));
}

/** Point text: its first baseline starts at `at`. */
export function pointText(
  text: string,
  at: Point,
  style: TextStyle,
  align: TextAlign = 'left'
): TextLayer {
  const ps = toPsText(text);
  return {
    text: ps,
    runs: [{ length: ps.length, style }],
    paragraphs: paragraphsOf(ps, () => align),
    transform: [1, 0, 0, 1, Math.round(at.x), Math.round(at.y)],
    area: null,
    orientation: 'horizontal',
    antiAlias: 'smooth',
    warped: false,
  };
}

/**
 * The layer with new characters (editor text): runs before and after the
 * change keep their styles, the run where it happened grows or shrinks,
 * and paragraphs keep their alignment by position.
 */
export function retext(layer: TextLayer, edited: string): TextLayer {
  const before = layer.text;
  const after = toPsText(edited);
  let prefix = 0;
  const max = Math.min(before.length, after.length);
  while (prefix < max && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  // `before[prefix, removedEnd)` became `after[prefix, after.length - suffix)`.
  const removedEnd = before.length - suffix;
  const inserted = after.length - suffix - prefix;

  let start = 0;
  const spans = layer.runs.map((run) => {
    const span = { start, end: start + run.length, style: run.style };
    start = span.end;
    return span;
  });
  const lengths = spans.map(
    (s) =>
      s.end -
      s.start -
      Math.max(0, Math.min(s.end, removedEnd) - Math.max(s.start, prefix))
  );
  // Typed characters take the style of the character before them.
  const owner =
    prefix === 0 ? 0 : spans.findIndex((s) => s.start < prefix && prefix <= s.end);
  if (lengths.length > 0) lengths[Math.max(0, owner)] += inserted;
  const runs: TextLayer['runs'] = spans
    .map((s, i) => ({ length: lengths[i], style: s.style }))
    .filter((r) => r.length > 0);
  const total = runs.reduce((n, r) => n + r.length, 0);
  if (runs.length === 0) {
    runs.push({
      length: after.length,
      style: layer.runs[0]?.style ?? defaultTextStyle({ r: 0, g: 0, b: 0 }),
    });
  } else if (total !== after.length) {
    // Runs that did not cover the text: the last one takes the rest.
    const last = runs[runs.length - 1];
    last.length = Math.max(1, last.length + after.length - total);
  }

  const aligns = layer.paragraphs.map((p) => p.align);
  return {
    ...layer,
    text: after,
    runs,
    paragraphs: paragraphsOf(
      after,
      (i) => aligns[Math.min(i, aligns.length - 1)] ?? 'left'
    ),
  };
}

/** The layer with every run's style changed by `patch`. */
export function restyle(
  layer: TextLayer,
  patch: Partial<TextStyle>
): TextLayer {
  return {
    ...layer,
    runs: layer.runs.map((r) => ({ ...r, style: { ...r.style, ...patch } })),
  };
}

/** The layer with every paragraph aligned the same way. */
export function realign(layer: TextLayer, align: TextAlign): TextLayer {
  return {
    ...layer,
    paragraphs: layer.paragraphs.map((p) => ({ ...p, align })),
  };
}

/** The first run's style (what the panel shows). */
export const leadStyle = (layer: TextLayer): TextStyle | undefined =>
  layer.runs[0]?.style;

/**
 * A PostScript name for a family and style, as Photoshop writes them
 * ("Inter" + "Bold" → "Inter-Bold"; Regular has no suffix past the dash).
 */
export function postscriptName(family: string, style: string): string {
  const base = family.replace(/\s+/g, '');
  const suffix = style.replace(/\s+/g, '');
  return suffix ? `${base}-${suffix}` : base;
}
