/**
 * Translates editing intents (typing, deleting, formatting) into engine
 * operations, and predicts where the caret lands so the editor can move it
 * before the engine answers.
 */

import type {
  CellRef,
  EditOp,
  ParaPatch,
  RunPatch,
  TextLayoutInfo,
  TextPos,
} from '@core/pptx-engine/types';
import {
  comparePos,
  moveHorizontal,
  moveWord,
  orderRange,
  paragraphLength,
  textEnd,
  wordAt,
} from './caret';

/** The text being edited: a shape on a slide (or one of its table cells). */
export interface TextTarget {
  slide: number;
  shape: number;
  cell?: CellRef;
}

/** Caret (`focus`) and selection anchor. Equal positions mean no selection. */
export interface TextSelection {
  anchor: TextPos;
  focus: TextPos;
}

export interface TextCommand {
  ops: EditOp[];
  /** Where the caret is after the ops apply. */
  caret: TextPos;
}

export function isCollapsed(s: TextSelection): boolean {
  return comparePos(s.anchor, s.focus) === 0;
}

/** Where the caret ends up after inserting `text` at `at`. */
export function advance(at: TextPos, text: string): TextPos {
  const pieces = text.split('\n');
  if (pieces.length === 1)
    return { ...at, offset: at.offset + [...text].length };
  return {
    paragraph: at.paragraph + pieces.length - 1,
    offset: [...pieces[pieces.length - 1]].length,
  };
}

/** Normalizes pasted or typed text: `\r\n` → `\n`, tabs kept, other controls dropped. */
export function normalizeText(text: string): string {
  const unified = text.replace(/\r\n?/g, '\n');
  // Keep tab, line feed, and the vertical tab used for line breaks.
  const kept = new Set(['\t', '\n', '\u000b']);
  return [...unified]
    .filter((c) => {
      const code = c.codePointAt(0) ?? 0;
      return kept.has(c) || (code >= 0x20 && code !== 0x7f);
    })
    .join('');
}

/** Replaces the selection with `text` (`\n` splits paragraphs, `\u000b` breaks lines). */
export function insertCommand(
  target: TextTarget,
  selection: TextSelection,
  text: string
): TextCommand {
  const [start, end] = orderRange(selection.anchor, selection.focus);
  const ops: EditOp[] = [];
  if (!isCollapsed(selection))
    ops.push({ op: 'deleteText', ...target, start, end });
  const clean = normalizeText(text);
  if (clean.length > 0)
    ops.push({ op: 'insertText', ...target, at: start, text: clean });
  return { ops, caret: advance(start, clean) };
}

/**
 * Deletes the selection, or one character/word before or after the caret.
 * Returns `null` when there is nothing to delete.
 */
export function deleteCommand(
  target: TextTarget,
  layout: TextLayoutInfo,
  selection: TextSelection,
  direction: -1 | 1,
  unit: 'char' | 'word' = 'char'
): TextCommand | null {
  let [start, end] = orderRange(selection.anchor, selection.focus);
  if (isCollapsed(selection)) {
    const moved =
      unit === 'word'
        ? moveWord(layout, selection.focus, direction)
        : moveHorizontal(layout, selection.focus, direction);
    if (comparePos(moved, selection.focus) === 0) return null;
    [start, end] = orderRange(moved, selection.focus);
  }
  return { ops: [{ op: 'deleteText', ...target, start, end }], caret: start };
}

/** The range formatting applies to: the selection, else the word at the caret. */
export function formatRange(
  layout: TextLayoutInfo | null,
  selection: TextSelection | null
): [TextPos, TextPos] | null {
  if (!selection) return null;
  if (!isCollapsed(selection))
    return orderRange(selection.anchor, selection.focus);
  if (!layout) return null;
  const [a, b] = wordAt(layout, selection.focus);
  return comparePos(a, b) === 0 ? null : [a, b];
}

/** Character formatting for a range, or for the whole text when `range` is null. */
export function formatCommand(
  target: TextTarget,
  range: [TextPos, TextPos] | null,
  props: RunPatch
): EditOp {
  return range
    ? { op: 'formatText', ...target, start: range[0], end: range[1], props }
    : { op: 'formatText', ...target, props };
}

/** Paragraph formatting for the paragraphs a range touches (all when null). */
export function paragraphCommand(
  target: TextTarget,
  range: [TextPos, TextPos] | null,
  props: ParaPatch
): EditOp {
  return range
    ? {
        op: 'formatParagraphs',
        ...target,
        from: range[0].paragraph,
        to: range[1].paragraph,
        props,
      }
    : { op: 'formatParagraphs', ...target, props };
}

/** Selects all text. */
export function selectAll(layout: TextLayoutInfo): TextSelection {
  return { anchor: { paragraph: 0, offset: 0 }, focus: textEnd(layout) };
}

/** Clamps a position into the layout (after the text changed underneath it). */
export function clampPos(layout: TextLayoutInfo, pos: TextPos): TextPos {
  const last = Math.max(0, layout.paragraphs.length - 1);
  const paragraph = Math.min(Math.max(0, pos.paragraph), last);
  return {
    paragraph,
    offset: Math.min(
      Math.max(0, pos.offset),
      paragraphLength(layout, paragraph)
    ),
  };
}
