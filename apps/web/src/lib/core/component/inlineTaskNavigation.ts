import { $isDocumentMentionNode } from '@macro-inc/lexical-core';
import {
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  SKIP_DOM_SELECTION_TAG,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from 'lexical';

export type TaskEdge = 'start' | 'end';
export type TaskDirection = 'previous' | 'next';

export function isPlainArrow(event: KeyboardEvent): boolean {
  return !event.isComposing && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
}

function focusTask(editor: LexicalEditor, key: NodeKey, edge: TaskEdge): boolean {
  const title = editor.getElementByKey(key)?.querySelector<HTMLElement>(
    '[data-inline-task-title][data-inline-task-editable]'
  );
  if (!title) return false;
  // Leave atomic mention selection behind without letting reconciliation steal input focus.
  editor.update(() => $setSelection(null), {
    discrete: true,
    tag: SKIP_DOM_SELECTION_TAG,
  });
  const input = title.querySelector<HTMLInputElement>('input');
  if (input) {
    input.focus({ preventScroll: true });
    const offset = edge === 'start' ? 0 : input.value.length;
    input.setSelectionRange(offset, offset);
  } else {
    title.dataset.inlineTaskEdge = edge;
    title.focus({ preventScroll: true });
  }
  return true;
}

/** Focus a neighboring task title or editor-local draft, without changing Lexical content. */
export function focusNeighborTask(
  editor: LexicalEditor,
  key: NodeKey,
  direction: TaskDirection
): boolean {
  let mentionKey: NodeKey | undefined;
  let paragraphKey: NodeKey | undefined;
  editor.getEditorState().read(() => {
    const node = $getNodeByKey(key);
    const paragraph = $isParagraphNode(node) ? node : node?.getParent();
    if (!$isParagraphNode(paragraph)) return;
    const neighbor = direction === 'previous'
      ? paragraph.getPreviousSibling()
      : paragraph.getNextSibling();
    if (!$isParagraphNode(neighbor)) return;
    paragraphKey = neighbor.getKey();
    const task = neighbor.getChildren().find(
      (child) => $isDocumentMentionNode(child) && child.getBlockName() === 'task'
    );
    if (task) mentionKey = task.getKey();
  });
  if (mentionKey && focusTask(editor, mentionKey, direction === 'previous' ? 'end' : 'start')) {
    return true;
  }
  const root = editor.getRootElement()?.parentElement;
  const draft = Array.from(root?.querySelectorAll<HTMLElement>('[data-inline-task-draft]') ?? []).find(
    (element) => element.dataset.inlineTaskDraft === paragraphKey
  );
  const input = draft?.querySelector<HTMLInputElement>('input:not(:disabled)');
  if (!input) return false;
  input.focus({ preventScroll: true });
  const offset = direction === 'previous' ? input.value.length : 0;
  input.setSelectionRange(offset, offset);
  return true;
}

/** Enter a task mention only when the editor caret touches its immediate edge. */
export function focusAdjacentTask(
  editor: LexicalEditor,
  direction: TaskDirection,
  mentionKey: NodeKey
): boolean {
  let key: NodeKey | undefined;
  const selection = $getSelection();
  if ($isNodeSelection(selection)) {
    return selection.has(mentionKey)
      ? focusTask(editor, mentionKey, direction === 'previous' ? 'end' : 'start')
      : false;
  }
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const anchor = selection.anchor;
  const node = anchor.getNode();
  let adjacent: LexicalNode | null = null;
  if (anchor.type === 'element' && $isElementNode(node)) {
    adjacent = node.getChildAtIndex(anchor.offset + (direction === 'previous' ? -1 : 0));
  } else if ($isTextNode(node)) {
    if (anchor.offset !== (direction === 'previous' ? 0 : node.getTextContentSize())) return false;
    adjacent = direction === 'previous' ? node.getPreviousSibling() : node.getNextSibling();
  }
  if ($isDocumentMentionNode(adjacent) && adjacent.getBlockName() === 'task') {
    key = adjacent.getKey();
  }
  return key === mentionKey
    ? focusTask(editor, key, direction === 'previous' ? 'end' : 'start')
    : false;
}

export function returnToDocument(
  editor: LexicalEditor,
  key: NodeKey,
  edge: TaskEdge,
  direction?: TaskDirection
): void {
  const root = editor.getRootElement();
  if (!root) return;
  // Lexical ignores DOM selection updates while a decorator input owns focus.
  // Move native focus first, then place the document caret explicitly.
  root.focus({ preventScroll: true });
  editor.update(() => {
    const node = $getNodeByKey(key);
    if (!$isDocumentMentionNode(node)) return;
    const parent = node.getParent();
    if (!parent) return;
    if (direction) {
      const neighbor = direction === 'previous'
        ? parent.getPreviousSibling()
        : parent.getNextSibling();
      if ($isElementNode(neighbor)) {
        if (direction === 'previous') neighbor.selectEnd();
        else neighbor.selectStart();
        return;
      }
    }
    const offset = node.getIndexWithinParent() + (edge === 'end' ? 1 : 0);
    parent.select(offset, offset);
  }, { discrete: true });
}

