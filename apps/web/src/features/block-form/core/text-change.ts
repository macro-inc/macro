/**
 * Plain-text changes for native inputs over shared text: the one span that
 * differs between two versions, and where a selection lands across it.
 */

/** `removed` characters at `start` were replaced by `inserted`. */
export type TextChange = {
  start: number;
  removed: number;
  inserted: string;
};

export type TextSelection = { start: number; end: number };

/** The single differing span between `before` and `after`. */
export function textChange(before: string, after: string): TextChange {
  const shorter = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < shorter && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < shorter - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  return {
    start: prefix,
    removed: before.length - prefix - suffix,
    inserted: after.slice(prefix, after.length - suffix),
  };
}

/**
 * Where `offset` lands after `change`. At the change's edge or inside the
 * replaced text, `before` keeps it ahead of the inserted text and `after`
 * puts it past.
 */
function mapOffset(
  offset: number,
  change: TextChange,
  bias: 'before' | 'after'
): number {
  if (offset < change.start || (offset === change.start && bias === 'before'))
    return offset;
  if (offset >= change.start + change.removed)
    return offset + change.inserted.length - change.removed;
  return bias === 'before'
    ? change.start
    : change.start + change.inserted.length;
}

/**
 * A selection across `change`: a caret stays ahead of text inserted at it, a
 * range keeps to its own text and shrinks to what survives a replacement.
 */
export function mapSelection(
  selection: TextSelection,
  change: TextChange
): TextSelection {
  if (selection.start === selection.end) {
    const caret = mapOffset(selection.start, change, 'before');
    return { start: caret, end: caret };
  }
  const start = mapOffset(selection.start, change, 'after');
  const end = mapOffset(selection.end, change, 'before');
  return start <= end ? { start, end } : { start, end: start };
}

/**
 * The person's edit of `base` (now `local`) replayed onto `remote`, a
 * concurrent edit of the same base, so neither is lost.
 */
export function rebaseEdit(
  base: string,
  local: string,
  remote: string
): string {
  const mine = textChange(base, local);
  const theirs = textChange(base, remote);
  const start = mapOffset(mine.start, theirs, 'after');
  const end = Math.max(
    start,
    mapOffset(mine.start + mine.removed, theirs, 'before')
  );
  return remote.slice(0, start) + mine.inserted + remote.slice(end);
}
