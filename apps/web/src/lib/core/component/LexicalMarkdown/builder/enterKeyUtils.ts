import { $isListItemNode } from '@lexical/list';
import { $findMatchingParent } from '@lexical/utils';
import { $getSelection, $isRangeSelection } from 'lexical';

export function shouldInsertNewlineOnEnter(event: {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  return event.shiftKey && !event.metaKey && !event.ctrlKey;
}

/**
 * Whether a plain Enter (no Cmd or Ctrl) belongs to the list holding the
 * caret: it adds an item, or on an empty item leaves the list or outdents,
 * as in documents. A composer's own Enter (send, save) then waits until the
 * caret is outside every list; Cmd/Ctrl+Enter still reaches it. A selection
 * with either end in a list counts, so the direction it was made in never
 * decides whether Enter sends.
 */
export function $enterContinuesList(event: {
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  if (event.metaKey || event.ctrlKey) return false;
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  return [selection.anchor, selection.focus].some(
    (point) => $findMatchingParent(point.getNode(), $isListItemNode) !== null
  );
}
