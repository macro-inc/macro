/**
 * Mobile keyboards commit text differently from a desktop keystroke.
 * Suggestion taps and glide typing insert a whole token, often with a
 * trailing space, in one update. The caret can land on that space instead
 * of after it. Block markdown shortcuts (`- `, `# `, `1. `) only look at
 * one newly typed character, so those commits stay as literal text and the
 * next space just lengthens the run.
 */

export type TextPoint = {
  key: string;
  offset: number;
  text: string;
};

export type BlockShortcutSpan = {
  /** Text from the start of the node through the shortcut, including extra spaces. */
  text: string;
  /** Offset where the shortcut ends, covering spaces the caret was left in front of. */
  endOffset: number;
};

/**
 * A block shortcut is only the marker plus spaces, occupying the node up to
 * the caret (and any spaces the caret was left sitting on). Content after
 * that is a normal sentence, not a shortcut.
 */
export function blockShortcutSpan(
  text: string,
  offset: number
): BlockShortcutSpan | null {
  if (offset < 0 || offset > text.length) return null;

  let end = offset;
  while (end < text.length && text[end] === ' ') end++;

  const candidate = text.slice(0, end);
  if (!candidate.endsWith(' ')) return null;
  if (text.slice(end).trim() !== '') return null;

  return { endOffset: end, text: candidate };
}

/**
 * The stock shortcut handler already converts one typed space when the caret
 * sits just after a marker (`-` then ` `). Multi-character commits, a caret
 * left before the space, and a second space (`-  `) do not.
 */
export function stockShortcutHandlesSpace(args: {
  previous: TextPoint | null;
  offset: number;
  endOffset: number;
  matchLength: number;
  isCompositionEnd: boolean;
}): boolean {
  const { previous, offset, endOffset, matchLength, isCompositionEnd } = args;
  if (isCompositionEnd) return false;
  if (!previous) return false;
  if (endOffset !== offset) return false;
  if (matchLength !== offset) return false;
  return offset === previous.offset + 1;
}

/**
 * When a multi-character insert ends in a space but the caret is left on
 * that space, return the offset just past it. Desktop replacement does this
 * from the last key code; suggestion taps and glide commits often have none.
 */
export function trailingAcceptanceCaret(
  previous: TextPoint | null,
  next: TextPoint
): number | null {
  if (!previous || previous.key !== next.key) return null;
  if (next.offset >= next.text.length || next.text[next.offset] !== ' ') {
    return null;
  }

  const head = previous.text.slice(0, previous.offset);
  const tail = previous.text.slice(previous.offset);
  if (!next.text.startsWith(head) || !next.text.endsWith(tail)) return null;

  const inserted = next.text.slice(
    previous.offset,
    next.text.length - tail.length
  );
  if (inserted.length <= 1 || !inserted.endsWith(' ')) return null;
  if (next.offset !== previous.offset + inserted.length - 1) return null;
  return next.offset + 1;
}
