/**
 * Where a deck's misspellings are: the text of every shape, group member,
 * and table cell, checked in slide order, and the underlines of misspelled
 * words in a laid-out text body.
 */

import type {
  CellRef,
  DeckOutline,
  EditOp,
  LineBox,
  ShapeOutline,
  SlideOutline,
  TextLayoutInfo,
} from '@core/pptx-engine/types';
import { applyAffine, type Point } from './geometry';
import {
  type AcceptedWords,
  misspelledWords,
  type Speller,
  type WordToken,
} from './spelling';

/** The text of one shape or table cell, by paragraph. */
export interface TextSource {
  shape: number;
  cell?: CellRef;
  paragraphs: string[];
}

/** A misspelled word somewhere in the deck. */
export interface Misspelling extends WordToken {
  slideId: number;
  slideIndex: number;
  shape: number;
  cell?: CellRef;
  paragraph: number;
}

/** Identifies a text body (`shape` or `shape:row,col`). */
export const sourceKey = (shape: number, cell?: CellRef) =>
  cell ? `${shape}:${cell.row},${cell.col}` : `${shape}`;

/** Identifies one occurrence (Ignore Once remembers these). */
export const misspellingKey = (m: Misspelling) =>
  `${m.slideId}/${sourceKey(m.shape, m.cell)}/${m.paragraph}/${m.start}/${m.word}`;

/** The text bodies of a slide, back to front, group members in place. */
export function slideTexts(slide: SlideOutline): TextSource[] {
  const out: TextSource[] = [];
  const visit = (shapes: ShapeOutline[]) => {
    for (const s of shapes) {
      if (s.children?.length) visit(s.children);
      if (s.table) {
        s.table.rows.forEach((row, r) =>
          row.forEach((text, c) => {
            if (!text || s.table?.cells[r]?.[c]?.merged) return;
            out.push({
              shape: s.id,
              cell: { row: r, col: c },
              paragraphs: text.split('\n'),
            });
          })
        );
      } else if (s.textEditable && s.paragraphs?.length) {
        out.push({ shape: s.id, paragraphs: s.paragraphs.map((p) => p.text) });
      }
    }
  };
  visit(slide.shapes);
  return out;
}

/** The misspellings of one text body. */
export function sourceMisspellings(
  slide: SlideOutline,
  source: TextSource,
  speller: Speller,
  accepted?: AcceptedWords
): Misspelling[] {
  return source.paragraphs.flatMap((text, paragraph) =>
    misspelledWords(text, speller, accepted).map((w) => ({
      ...w,
      slideId: slide.id,
      slideIndex: slide.index,
      shape: source.shape,
      cell: source.cell,
      paragraph,
    }))
  );
}

/** A slide's misspellings in reading order. */
export function slideMisspellings(
  slide: SlideOutline,
  speller: Speller,
  accepted?: AcceptedWords
): Misspelling[] {
  return slideTexts(slide).flatMap((source) =>
    sourceMisspellings(slide, source, speller, accepted)
  );
}

/**
 * The deck's misspellings from slide `start` on, wrapping around to the
 * slides before it, as Review ▸ Spelling walks them.
 */
export function deckMisspellings(
  deck: DeckOutline,
  start: number,
  speller: Speller,
  accepted?: AcceptedWords
): Misspelling[] {
  const n = deck.slides.length;
  const out: Misspelling[] = [];
  for (let k = 0; k < n; k++) {
    const slide = deck.slides[(start + k) % n];
    out.push(...slideMisspellings(slide, speller, accepted));
  }
  return out;
}

/**
 * Operations replacing occurrences with `replacement`. Each takes the
 * formatting of the word it replaces (the text goes in before the word is
 * removed), and occurrences later in a paragraph go first so earlier
 * positions stay valid.
 */
export function replaceOps(
  occurrences: Misspelling[],
  replacement: string | ((m: Misspelling) => string)
): EditOp[] {
  const sorted = [...occurrences].sort(
    (a, b) =>
      a.slideIndex - b.slideIndex ||
      sourceKey(a.shape, a.cell).localeCompare(sourceKey(b.shape, b.cell)) ||
      a.paragraph - b.paragraph ||
      b.start - a.start
  );
  return sorted.flatMap((m) => {
    const target = {
      slide: m.slideId,
      shape: m.shape,
      ...(m.cell ? { cell: m.cell } : {}),
    };
    const ops: EditOp[] = [];
    const text = typeof replacement === 'string' ? replacement : replacement(m);
    if (text)
      ops.push({
        op: 'insertText',
        ...target,
        at: { paragraph: m.paragraph, offset: m.end },
        text,
      });
    ops.push({
      op: 'deleteText',
      ...target,
      start: { paragraph: m.paragraph, offset: m.start },
      end: { paragraph: m.paragraph, offset: m.end },
    });
    return ops;
  });
}

function stopX(line: LineBox, offset: number): number {
  let best = line.stops[0];
  for (const s of line.stops) if (s.index <= offset) best = s;
  return best?.x ?? 0;
}

/** Where a misspelled word is drawn, one piece per line it is on (slide points). */
export interface WordGeometry {
  /** The wavy underline: from → to, just below the baseline. */
  underlines: [Point, Point][];
  /** The word's boxes (for right-click hit testing), corners clockwise. */
  boxes: Point[][];
}

/** The underline and boxes of `start..end` of a paragraph of a laid-out body. */
export function wordGeometry(
  layout: TextLayoutInfo,
  paragraph: number,
  start: number,
  end: number
): WordGeometry {
  const underlines: [Point, Point][] = [];
  const boxes: Point[][] = [];
  for (const line of layout.lines) {
    if (line.paragraph !== paragraph || line.stops.length === 0) continue;
    const first = line.stops[0].index;
    const last = line.stops[line.stops.length - 1].index;
    const from = Math.max(first, start);
    const to = Math.min(last, end);
    if (from >= to) continue;
    const x0 = stopX(line, from);
    const x1 = stopX(line, to);
    const y = line.baseline + (line.bottom - line.baseline) * 0.45;
    const t = (x: number, yy: number) =>
      applyAffine(layout.transform, { x, y: yy });
    underlines.push([t(x0, y), t(x1, y)]);
    boxes.push([
      t(x0, line.top),
      t(x1, line.top),
      t(x1, line.bottom),
      t(x0, line.bottom),
    ]);
  }
  return { underlines, boxes };
}

/** Whether `p` is inside a convex quad. */
export function inQuad(quad: Point[], p: Point): boolean {
  let sign = 0;
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % quad.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** A zigzag along `from` → `to` (PowerPoint's red wavy underline). */
export function wavyPath(from: Point, to: Point, wave: number): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0 || wave <= 0) return '';
  const ux = dx / length;
  const uy = dy / length;
  // The normal points down the page for unrotated text.
  const nx = -uy;
  const ny = ux;
  const steps = Math.max(2, Math.round(length / wave));
  const step = length / steps;
  let d = `M${from.x.toFixed(2)} ${from.y.toFixed(2)}`;
  for (let i = 1; i <= steps; i++) {
    const along = i * step;
    const off = (i % 2 === 1 ? -1 : 1) * wave * 0.5;
    const x = from.x + ux * along + nx * off;
    const y = from.y + uy * along + ny * off;
    d += `L${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d;
}
