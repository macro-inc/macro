/**
 * Finding text in a deck's outline: every shape's paragraphs (groups
 * included) and every table cell, in slide order, and the operations that
 * replace matches.
 */

import type {
  CellRef,
  DeckOutline,
  EditOp,
  ShapeOutline,
} from '@core/pptx-engine/types';

export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
}

export interface TextMatch {
  slide: number;
  slideIndex: number;
  shape: number;
  cell?: CellRef;
  paragraph: number;
  /** Character offsets within the paragraph. */
  start: number;
  end: number;
}

const WORD = /[\p{L}\p{N}_]/u;

/** Matches of `query` in one paragraph (offsets in characters). */
export function matchesIn(
  text: string,
  query: string,
  options: FindOptions
): [number, number][] {
  if (!query) return [];
  const chars = [...text];
  const needle = [...query];
  const eq = (a: string, b: string) =>
    options.matchCase ? a === b : a.toLowerCase() === b.toLowerCase();
  const out: [number, number][] = [];
  for (let i = 0; i + needle.length <= chars.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (!eq(chars[i + j], needle[j])) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const end = i + needle.length;
    if (
      options.wholeWord &&
      ((i > 0 && WORD.test(chars[i - 1])) ||
        (end < chars.length && WORD.test(chars[end])))
    )
      continue;
    out.push([i, end]);
    i = end - 1;
  }
  return out;
}

/** Every match in the deck, in reading order. */
export function findInDeck(
  deck: DeckOutline,
  query: string,
  options: FindOptions
): TextMatch[] {
  const out: TextMatch[] = [];
  deck.slides.forEach((slide, slideIndex) => {
    const visit = (shape: ShapeOutline) => {
      (shape.paragraphs ?? []).forEach((p, paragraph) => {
        for (const [start, end] of matchesIn(p.text, query, options))
          out.push({
            slide: slide.id,
            slideIndex,
            shape: shape.id,
            paragraph,
            start,
            end,
          });
      });
      shape.table?.rows.forEach((row, r) =>
        row.forEach((text, c) =>
          text.split('\n').forEach((line, paragraph) => {
            for (const [start, end] of matchesIn(line, query, options))
              out.push({
                slide: slide.id,
                slideIndex,
                shape: shape.id,
                cell: { row: r, col: c },
                paragraph,
                start,
                end,
              });
          })
        )
      );
      for (const child of shape.children ?? []) visit(child);
    };
    for (const shape of slide.shapes) visit(shape);
  });
  return out;
}

/** Operations replacing one match. */
export function replaceOps(match: TextMatch, replacement: string): EditOp[] {
  const target = {
    slide: match.slide,
    shape: match.shape,
    ...(match.cell ? { cell: match.cell } : {}),
  };
  const ops: EditOp[] = [
    {
      op: 'deleteText',
      ...target,
      start: { paragraph: match.paragraph, offset: match.start },
      end: { paragraph: match.paragraph, offset: match.end },
    },
  ];
  if (replacement)
    ops.push({
      op: 'insertText',
      ...target,
      at: { paragraph: match.paragraph, offset: match.start },
      text: replacement,
    });
  return ops;
}

/**
 * Operations replacing every match. Matches later in a paragraph go first,
 * so earlier offsets stay valid.
 */
export function replaceAllOps(
  matches: TextMatch[],
  replacement: string
): EditOp[] {
  const sorted = [...matches].sort(
    (a, b) =>
      a.slideIndex - b.slideIndex ||
      a.shape - b.shape ||
      (a.cell?.row ?? -1) - (b.cell?.row ?? -1) ||
      (a.cell?.col ?? -1) - (b.cell?.col ?? -1) ||
      a.paragraph - b.paragraph ||
      b.start - a.start
  );
  return sorted.flatMap((m) => replaceOps(m, replacement));
}
