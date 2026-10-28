/**
 * Caret placement and movement over the engine's text layout
 * (`TextLayoutInfo`): every line lists the x position before each character
 * of its paragraph, so carets, selections, and hit testing need no font
 * knowledge on this side.
 */

import type { LineBox, TextLayoutInfo, TextPos } from '@core/pptx-engine/types';
import { applyAffine, invertAffine, type Point } from './geometry';

export function comparePos(a: TextPos, b: TextPos): number {
  return a.paragraph - b.paragraph || a.offset - b.offset;
}

export function orderRange(a: TextPos, b: TextPos): [TextPos, TextPos] {
  return comparePos(a, b) <= 0 ? [a, b] : [b, a];
}

export function paragraphLength(
  layout: TextLayoutInfo,
  paragraph: number
): number {
  return [...(layout.paragraphs[paragraph] ?? '')].length;
}

/** The line a position is drawn on (a wrapped line's end goes to the next line). */
export function lineIndexOf(layout: TextLayoutInfo, pos: TextPos): number {
  let fallback = -1;
  for (let i = 0; i < layout.lines.length; i++) {
    const line = layout.lines[i];
    if (line.paragraph !== pos.paragraph) continue;
    fallback = i;
    const first = line.stops[0]?.index ?? 0;
    const last = line.stops[line.stops.length - 1]?.index ?? 0;
    if (pos.offset >= first && pos.offset < last) return i;
    if (pos.offset === last) {
      const next = layout.lines[i + 1];
      const continues =
        next?.paragraph === pos.paragraph && next.stops[0]?.index === last;
      if (!continues) return i;
    }
  }
  return fallback;
}

function stopX(line: LineBox, offset: number): number {
  let best = line.stops[0];
  for (const s of line.stops) {
    if (s.index <= offset) best = s;
  }
  return best?.x ?? 0;
}

/** The caret as a segment in slide space (top → bottom of the line). */
export function caretSegment(
  layout: TextLayoutInfo,
  pos: TextPos
): [Point, Point] | null {
  const i = lineIndexOf(layout, pos);
  const line = layout.lines[i];
  if (!line) return null;
  const x = stopX(line, pos.offset);
  return [
    applyAffine(layout.transform, { x, y: line.top }),
    applyAffine(layout.transform, { x, y: line.bottom }),
  ];
}

/** Selection highlight quads in slide space, one per line touched. */
export function selectionQuads(
  layout: TextLayoutInfo,
  a: TextPos,
  b: TextPos
): Point[][] {
  const [start, end] = orderRange(a, b);
  const quads: Point[][] = [];
  layout.lines.forEach((line, i) => {
    if (line.paragraph < start.paragraph || line.paragraph > end.paragraph)
      return;
    const first = line.stops[0]?.index ?? 0;
    const last = line.stops[line.stops.length - 1]?.index ?? 0;
    const from =
      line.paragraph === start.paragraph
        ? Math.max(first, start.offset)
        : first;
    const to =
      line.paragraph === end.paragraph ? Math.min(last, end.offset) : last;
    if (from > to) return;
    // The paragraph break is selected when the range continues past this paragraph.
    const lastOfParagraph = layout.lines[i + 1]?.paragraph !== line.paragraph;
    const breakSelected = lastOfParagraph && line.paragraph < end.paragraph;
    if (from === to && !breakSelected) return;
    const x0 = stopX(line, from);
    const x1 = stopX(line, to) + (breakSelected ? 4 : 0);
    quads.push(
      [
        { x: x0, y: line.top },
        { x: x1, y: line.top },
        { x: x1, y: line.bottom },
        { x: x0, y: line.bottom },
      ].map((p) => applyAffine(layout.transform, p))
    );
  });
  return quads;
}

/** The text position nearest to a slide-space point. */
export function positionAt(layout: TextLayoutInfo, p: Point): TextPos | null {
  const inv = invertAffine(layout.transform);
  if (!inv || layout.lines.length === 0) return null;
  const q = applyAffine(inv, p);
  let best = layout.lines[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const line of layout.lines) {
    const d =
      q.y < line.top
        ? line.top - q.y
        : q.y > line.bottom
          ? q.y - line.bottom
          : 0;
    if (d < bestDist) {
      bestDist = d;
      best = line;
    }
  }
  return { paragraph: best.paragraph, offset: nearestStop(best, q.x) };
}

function nearestStop(line: LineBox, x: number): number {
  let best = line.stops[0]?.index ?? 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const s of line.stops) {
    const d = Math.abs(s.x - x);
    if (d < bestDist) {
      bestDist = d;
      best = s.index;
    }
  }
  return best;
}

/** Moves one character left or right, crossing paragraph boundaries. */
export function moveHorizontal(
  layout: TextLayoutInfo,
  pos: TextPos,
  dir: -1 | 1
): TextPos {
  if (dir < 0) {
    if (pos.offset > 0) return { ...pos, offset: pos.offset - 1 };
    if (pos.paragraph > 0) {
      const p = pos.paragraph - 1;
      return { paragraph: p, offset: paragraphLength(layout, p) };
    }
    return pos;
  }
  if (pos.offset < paragraphLength(layout, pos.paragraph))
    return { ...pos, offset: pos.offset + 1 };
  if (pos.paragraph < layout.paragraphs.length - 1)
    return { paragraph: pos.paragraph + 1, offset: 0 };
  return pos;
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);

/** Moves to the previous/next word boundary (Alt/Ctrl + arrow). */
export function moveWord(
  layout: TextLayoutInfo,
  pos: TextPos,
  dir: -1 | 1
): TextPos {
  const chars = [...(layout.paragraphs[pos.paragraph] ?? '')];
  let i = pos.offset;
  if (dir < 0) {
    if (i === 0) return moveHorizontal(layout, pos, -1);
    while (i > 0 && !isWordChar(chars[i - 1])) i--;
    while (i > 0 && isWordChar(chars[i - 1])) i--;
  } else {
    if (i >= chars.length) return moveHorizontal(layout, pos, 1);
    while (i < chars.length && !isWordChar(chars[i])) i++;
    while (i < chars.length && isWordChar(chars[i])) i++;
  }
  return { ...pos, offset: i };
}

/** Moves to the line above or below, keeping `goalX` (layout space) when given. */
export function moveVertical(
  layout: TextLayoutInfo,
  pos: TextPos,
  dir: -1 | 1,
  goalX?: number
): { pos: TextPos; goalX: number } {
  const i = lineIndexOf(layout, pos);
  const line = layout.lines[i];
  if (!line) return { pos, goalX: goalX ?? 0 };
  const x = goalX ?? stopX(line, pos.offset);
  const target = layout.lines[i + dir];
  if (!target) {
    const edge =
      dir < 0
        ? { paragraph: 0, offset: 0 }
        : {
            paragraph: layout.paragraphs.length - 1,
            offset: paragraphLength(layout, layout.paragraphs.length - 1),
          };
    return { pos: edge, goalX: x };
  }
  return {
    pos: { paragraph: target.paragraph, offset: nearestStop(target, x) },
    goalX: x,
  };
}

export type ArrowKey = 'left' | 'right' | 'up' | 'down';

const SCREEN: Record<ArrowKey, Point> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

/**
 * The caret move an arrow key makes: `left`/`right` step through the text,
 * `up`/`down` go to the previous/next line. In vertical text the keys
 * follow the screen, as in PowerPoint: in text rotated 90°, Down steps to
 * the next character and Left to the next line.
 */
export function logicalArrow(layout: TextLayoutInfo, key: ArrowKey): ArrowKey {
  const [a, b, c, d] = layout.transform;
  const v = SCREEN[key];
  const along = v.x * a + v.y * b;
  const across = v.x * c + v.y * d;
  if (Math.abs(along) >= Math.abs(across)) return along > 0 ? 'right' : 'left';
  // Lines usually follow each other down the layout; stacked and Mongolian
  // text lists them from the layout's far side.
  let up = 0;
  let down = 0;
  for (let i = 1; i < layout.lines.length; i++) {
    const step = layout.lines[i].top - layout.lines[i - 1].top;
    if (step > 0.01) down++;
    else if (step < -0.01) up++;
  }
  const forward = up > down ? across < 0 : across > 0;
  return forward ? 'down' : 'up';
}

/** Start or end of the visual line (Home / End). */
export function lineEdge(
  layout: TextLayoutInfo,
  pos: TextPos,
  end: boolean
): TextPos {
  const line = layout.lines[lineIndexOf(layout, pos)];
  if (!line || line.stops.length === 0) return pos;
  const stop = end ? line.stops[line.stops.length - 1] : line.stops[0];
  let offset = stop.index;
  // A wrapped line ends before the space it broke at.
  if (end) {
    const text = [...(layout.paragraphs[pos.paragraph] ?? '')];
    const next = layout.lines[lineIndexOf(layout, pos) + 1];
    if (
      next?.paragraph === pos.paragraph &&
      offset > 0 &&
      /\s/.test(text[offset - 1] ?? '')
    )
      offset -= 1;
  }
  return { paragraph: pos.paragraph, offset };
}

/** The word around a position (double-click selection). */
export function wordAt(
  layout: TextLayoutInfo,
  pos: TextPos
): [TextPos, TextPos] {
  const chars = [...(layout.paragraphs[pos.paragraph] ?? '')];
  let a = pos.offset;
  let b = pos.offset;
  const word = isWordChar(chars[a]) || isWordChar(chars[a - 1]);
  const same = (c: string | undefined) =>
    word ? isWordChar(c) : !!c && !isWordChar(c) && c !== '\u000b';
  while (a > 0 && same(chars[a - 1])) a--;
  while (b < chars.length && same(chars[b])) b++;
  return [
    { paragraph: pos.paragraph, offset: a },
    { paragraph: pos.paragraph, offset: b },
  ];
}

/** The end of the text. */
export function textEnd(layout: TextLayoutInfo): TextPos {
  const last = Math.max(0, layout.paragraphs.length - 1);
  return { paragraph: last, offset: paragraphLength(layout, last) };
}

/** The selected text (`\n` between paragraphs). */
export function textInRange(
  layout: TextLayoutInfo,
  a: TextPos,
  b: TextPos
): string {
  const [start, end] = orderRange(a, b);
  const parts: string[] = [];
  for (let p = start.paragraph; p <= end.paragraph; p++) {
    const chars = [...(layout.paragraphs[p] ?? '')];
    const from = p === start.paragraph ? start.offset : 0;
    const to = p === end.paragraph ? end.offset : chars.length;
    parts.push(chars.slice(from, to).join(''));
  }
  return parts.join('\n').replaceAll('\u000b', '\n');
}
