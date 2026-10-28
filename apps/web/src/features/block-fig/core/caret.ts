/**
 * The text editor's caret and selection over a text layer's laid out
 * lines (`TextGeometry`, in the layer's coordinates): where the caret
 * stands, the selection's rectangles, the character under a point, moving
 * up and down by line and to a line's ends, and the word or paragraph a
 * double or triple click selects. Indices are UTF-16 units, as in the
 * textarea that takes the typing.
 */

import type { CaretLine, TextGeometry } from '@core/fig-engine/types';

export interface CaretRect {
  x: number;
  top: number;
  height: number;
}

export interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The line a caret at `index` sits on: a caret at the end of a wrapped
 * line belongs to the start of the next, as in Figma.
 */
export function lineIndexOf(g: TextGeometry, index: number): number {
  let found = 0;
  for (let k = 0; k < g.lines.length; k++) {
    if (g.lines[k].start <= index) found = k;
    else break;
  }
  return found;
}

const xAt = (line: CaretLine, index: number) =>
  line.xs[Math.max(0, Math.min(line.xs.length - 1, index - line.start))] ?? 0;

/** Where the caret is drawn before character `index`. */
export function caretRect(g: TextGeometry, index: number): CaretRect | null {
  const line = g.lines[lineIndexOf(g, index)];
  if (!line) return null;
  return { x: xAt(line, index), top: line.top, height: line.height };
}

/** Rectangles covering characters `start..end`, one per line. */
export function selectionRects(
  g: TextGeometry,
  start: number,
  end: number
): SelectionRect[] {
  const [a, b] = start <= end ? [start, end] : [end, start];
  if (a === b) return [];
  const rects: SelectionRect[] = [];
  for (const line of g.lines) {
    const last = lineLast(g, line);
    const from = Math.max(a, line.start);
    const to = Math.min(b, last);
    // A selected line break shows as a sliver past the line's end.
    const coversBreak = last < line.end && a <= last && b > last;
    if (from > to || (from === to && !coversBreak)) continue;
    const x0 = xAt(line, from);
    let x1 = xAt(line, to);
    if (coversBreak) x1 += line.height * 0.25;
    if (x1 > x0) rects.push({ x: x0, y: line.top, w: x1 - x0, h: line.height });
  }
  return rects;
}

/** The caret index nearest a point in layer coordinates. */
export function hitIndex(g: TextGeometry, x: number, y: number): number {
  if (g.lines.length === 0) return 0;
  let line = g.lines[g.lines.length - 1];
  for (const l of g.lines) {
    if (y < l.top + l.height) {
      line = l;
      break;
    }
  }
  return nearestOnLine(g, line, x);
}

/** The last caret stop on a line before its line break, if it has one. */
function lineLast(g: TextGeometry, line: CaretLine): number {
  const last = g.lines[g.lines.length - 1];
  return line === last || line.end <= line.start ? line.end : line.end - 1;
}

function nearestOnLine(g: TextGeometry, line: CaretLine, x: number): number {
  const last = lineLast(g, line);
  let best = line.start;
  let distance = Number.POSITIVE_INFINITY;
  for (let i = line.start; i <= last; i++) {
    const d = Math.abs(xAt(line, i) - x);
    if (d < distance) {
      distance = d;
      best = i;
    }
  }
  return best;
}

/**
 * The index one line up (`-1`) or down (`1`) at `goalX`; past the first
 * or last line, the start or end of the text.
 */
export function verticalMove(
  g: TextGeometry,
  index: number,
  direction: -1 | 1,
  goalX: number
): number {
  const k = lineIndexOf(g, index) + direction;
  if (k < 0) return 0;
  if (k >= g.lines.length) return g.length;
  return nearestOnLine(g, g.lines[k], goalX);
}

/** The start and end (before its line break) of the line at `index`. */
export function lineEnds(g: TextGeometry, index: number): [number, number] {
  const line = g.lines[lineIndexOf(g, index)];
  if (!line) return [0, g.length];
  return [line.start, lineLast(g, line)];
}

const isWordChar = (ch: string) => /[\p{L}\p{N}_'’]/u.test(ch);

/** The word (or run of spaces or punctuation) around `index`. */
export function wordAt(text: string, index: number): [number, number] {
  if (text.length === 0) return [0, 0];
  const at = Math.min(index, text.length - 1);
  const kind = (i: number) =>
    isWordChar(text[i]) ? 'w' : /\s/.test(text[i]) ? 's' : 'p';
  const k = kind(at);
  if (text[at] === '\n') return [at, at];
  let a = at;
  let b = at + 1;
  while (a > 0 && kind(a - 1) === k && text[a - 1] !== '\n') a--;
  while (b < text.length && kind(b) === k && text[b] !== '\n') b++;
  return [a, b];
}

/** The paragraph around `index`, without its line break. */
export function paragraphAt(text: string, index: number): [number, number] {
  const a = text.lastIndexOf('\n', Math.max(0, index - 1));
  const start = index > 0 && text[index - 1] === '\n' ? index : a + 1;
  const next = text.indexOf('\n', start);
  return [start, next < 0 ? text.length : next];
}

/** A page point in a layer's coordinates (`transform` maps layer to page). */
export function toLayer(
  transform: TextGeometry['transform'],
  x: number,
  y: number
): { x: number; y: number } {
  const [a, b, c, d, e, f] = transform;
  const det = a * d - b * c || 1;
  const px = x - e;
  const py = y - f;
  return { x: (d * px - c * py) / det, y: (-b * px + a * py) / det };
}
