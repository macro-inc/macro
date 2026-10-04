import { DOCX_LORO_CONTAINERS } from '@macro-inc/collaboration/docx/schema';
import type { LoroDoc } from 'loro-crdt';

/**
 * Where a comment thread is anchored in a DOCX: a span of one paragraph's
 * text. Marks live in the collaborative document, beside the blocks, and are
 * joined to message threads by mark id the same way markdown comment marks
 * are. The document file itself is never modified by commenting.
 */
export type CommentMark = {
  /** Persisted engine id of the paragraph. */
  block: string;
  start: number;
  length: number;
  /** The text the mark covered when it was placed or last relocated. */
  text: string;
};

export type ResolvedMark = CommentMark & { relocated: boolean };

function parseMark(value: unknown): CommentMark | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as Partial<CommentMark>;
    if (
      typeof parsed.block === 'string' &&
      typeof parsed.start === 'number' &&
      typeof parsed.length === 'number' &&
      typeof parsed.text === 'string' &&
      parsed.length > 0
    )
      return {
        block: parsed.block,
        start: parsed.start,
        length: parsed.length,
        text: parsed.text,
      };
  } catch {
    // A malformed mark is ignored rather than breaking every other comment.
  }
  return null;
}

export function readCommentMarks(doc: LoroDoc): Map<string, CommentMark> {
  const map = doc.getMap(DOCX_LORO_CONTAINERS.marks);
  const marks = new Map<string, CommentMark>();
  for (const id of map.keys()) {
    const mark = parseMark(map.get(id));
    if (mark) marks.set(id, mark);
  }
  return marks;
}

/** Longest quoted text a mark keeps; longer selections anchor on their start. */
export const MAX_MARK_TEXT = 1000;

export function writeCommentMark(doc: LoroDoc, id: string, mark: CommentMark) {
  doc.getMap(DOCX_LORO_CONTAINERS.marks).set(
    id,
    JSON.stringify({
      ...mark,
      length: Math.min(mark.length, MAX_MARK_TEXT),
      text: mark.text.slice(0, MAX_MARK_TEXT),
    })
  );
  doc.commit({ origin: 'docx-comment' });
}

export function deleteCommentMark(doc: LoroDoc, id: string) {
  doc.getMap(DOCX_LORO_CONTAINERS.marks).delete(id);
  doc.commit({ origin: 'docx-comment' });
}

function nearestOccurrence(haystack: string, needle: string, near: number) {
  let best = -1;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    if (best < 0 || Math.abs(index - near) < Math.abs(best - near))
      best = index;
    index = haystack.indexOf(needle, index + 1);
  }
  return best;
}

/**
 * Find a mark's text in the current document. The mark keeps its place while
 * its paragraph's text there is unchanged; otherwise the nearest occurrence in
 * the same paragraph wins, then the occurrence in the closest other paragraph
 * (a split moves text to a new paragraph). Null means the text is gone.
 *
 * `blocks` lists paragraph ids and texts in document order.
 */
export function resolveMark(
  mark: CommentMark,
  blocks: ReadonlyArray<{ id: string; text: string }>
): ResolvedMark | null {
  const home = blocks.findIndex((block) => block.id === mark.block);
  if (home >= 0) {
    const text = blocks[home].text;
    if (text.slice(mark.start, mark.start + mark.length) === mark.text)
      return { ...mark, relocated: false };
    const start = nearestOccurrence(text, mark.text, mark.start);
    if (start >= 0)
      return { ...mark, start, length: mark.text.length, relocated: true };
  }
  type Match = { index: number; start: number; distance: number };
  let best: Match | null = null;
  blocks.forEach((block, index) => {
    if (index === home) return;
    const start = block.text.indexOf(mark.text);
    if (start < 0) return;
    const distance = home >= 0 ? Math.abs(index - home) : index;
    if (!best || distance < best.distance) best = { index, start, distance };
  });
  if (!best) return null;
  const found: Match = best;
  return {
    block: blocks[found.index].id,
    start: found.start,
    length: mark.text.length,
    text: mark.text,
    relocated: true,
  };
}
