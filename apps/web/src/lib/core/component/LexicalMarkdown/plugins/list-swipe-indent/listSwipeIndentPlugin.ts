/**
 * @file Apple Notes-style swipe indent for list items on touch.
 *
 * A mostly-horizontal finger swipe on a list row indents (right) or outdents
 * (left) that item one level, taking nested children with it. Vertical pans
 * stay scrolling; taps and mouse drags are left alone. The same depth limit
 * as tab indentation applies: at most one level deeper than the previous
 * sibling, and the first item in a list cannot indent (nothing to nest under).
 */
import {
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListItemNode,
} from '@lexical/list';
import { $findMatchingParent } from '@lexical/utils';
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $isElementNode,
  type LexicalEditor,
  type NodeKey,
} from 'lexical';
import { $collectNestedGroup } from '../draggable-block/draggableBlockPlugin';

/** Movement below this is a tap or scroll jitter, not a swipe. */
const SLOP_PX = 12;
/** Release past this distance commits one indent/outdent. */
const COMMIT_PX = 40;
/** Visual slide cap while the finger is down. */
const MAX_TRANSLATE_PX = 48;
/** Ignore swipes that start on the iOS back-gesture edge. */
const EDGE_GUARD_PX = 16;
const RUBBER_BAND = 0.25;
const SNAP_BACK_MS = 150;

export function $canIndentListItem(item: ListItemNode): boolean {
  if (!item.canIndent()) return false;
  const prev = item.getPreviousSibling();
  if (!$isElementNode(prev)) return false;
  return item.getIndent() < prev.getIndent() + 1;
}

export function $canOutdentListItem(item: ListItemNode): boolean {
  return item.getIndent() > 0;
}

/**
 * Lexical's ListItemNode.setIndent no-ops on nesting wrappers (a list item
 * whose only child is a list). Prefer the inner text item.
 */
function $unwrapNestedListItem(item: ListItemNode): ListItemNode {
  let current = item;
  while ($isListNode(current.getFirstChild())) {
    const inner = current.getFirstChild()?.getFirstChild();
    if (!$isListItemNode(inner)) break;
    current = inner;
  }
  return current;
}

/**
 * Rewrite used when ListItemNode.setIndent claims success but the tree
 * didn't change (its loop increments even if $handleIndent is a no-op).
 */
function $nestUnderPreviousSibling(item: ListItemNode): boolean {
  const parent = item.getParent();
  if (!$isListNode(parent)) return false;
  const prev = item.getPreviousSibling();
  if (!$isListItemNode(prev)) return false;
  const existing = prev.getChildren().find($isListNode);
  if (existing) {
    existing.append(item);
    return true;
  }
  const nested = $createListNode(parent.getListType());
  prev.append(nested);
  nested.append(item);
  return true;
}

function $unnestFromParentList(item: ListItemNode): boolean {
  const parent = item.getParent();
  if (!$isListNode(parent)) return false;
  const grand = parent.getParent();
  if (!$isListItemNode(grand)) return false;
  grand.insertAfter(item);
  if (parent.getChildrenSize() === 0) grand.remove();
  return true;
}

/** Indent one list item, falling back to a nest-under-previous rewrite. */
export function $indentListItem(item: ListItemNode): boolean {
  const target = $unwrapNestedListItem(item);
  if (!$canIndentListItem(target)) return false;
  const before = target.getIndent();
  target.setIndent(before + 1);
  if (target.getIndent() > before) return true;
  return $nestUnderPreviousSibling(target);
}

/**
 * Outdent one list item. Nested children come along because Lexical's
 * ListItemNode.setIndent rewrites the tree (same path as Shift+Tab).
 */
export function $outdentListItem(item: ListItemNode): boolean {
  const target = $unwrapNestedListItem(item);
  if (!$canOutdentListItem(target)) return false;
  const before = target.getIndent();
  target.setIndent(before - 1);
  if (target.getIndent() < before) return true;
  return $unnestFromParentList(target);
}

function listItemFromTarget(target: EventTarget | null): ListItemNode | null {
  if (!(target instanceof Node)) return null;
  const nearest = $getNearestNodeFromDOMNode(target);
  if (!nearest) return null;
  const item = $isListItemNode(nearest)
    ? nearest
    : $findMatchingParent(nearest, $isListItemNode);
  if (!item) return null;
  return $unwrapNestedListItem(item);
}

function groupElements(
  editor: LexicalEditor,
  item: ListItemNode
): HTMLElement[] {
  const elems: HTMLElement[] = [];
  for (const node of $collectNestedGroup(item)) {
    const elem = editor.getElementByKey(node.getKey());
    if (elem) elems.push(elem);
  }
  return elems;
}

function setTranslate(elems: HTMLElement[], dx: number) {
  const value = `translateX(${dx}px)`;
  for (const elem of elems) {
    elem.style.transform = value;
  }
}

function clearTranslate(elems: HTMLElement[], animate: boolean) {
  for (const elem of elems) {
    if (animate) {
      elem.style.transition = `transform ${SNAP_BACK_MS}ms ease-out`;
    } else {
      elem.style.transition = '';
    }
    elem.style.transform = '';
  }
  if (!animate) return;
  window.setTimeout(() => {
    for (const elem of elems) {
      elem.style.transition = '';
    }
  }, SNAP_BACK_MS);
}

function registerListSwipeIndent(editor: LexicalEditor): () => void {
  let endGesture: (() => void) | null = null;
  let detachRoot: (() => void) | null = null;

  const attach = (root: HTMLElement): (() => void) => {
    const onPointerDown = (down: PointerEvent) => {
      if (down.pointerType !== 'touch') return;
      if (down.isPrimary === false) return;
      if (!editor.isEditable()) return;
      if (down.clientX < EDGE_GUARD_PX) return;
      const eventTarget = down.target;
      if (!(eventTarget instanceof Node) || !root.contains(eventTarget)) return;
      endGesture?.();

      let itemKey: NodeKey | null = null;
      let elems: HTMLElement[] = [];
      let canIndent = false;
      let canOutdent = false;

      const fallbackLi =
        eventTarget instanceof Element
          ? eventTarget.closest('li')
          : eventTarget.parentElement?.closest('li');

      editor.read(() => {
        const item = listItemFromTarget(eventTarget);
        if (!item) return;
        itemKey = item.getKey();
        elems = groupElements(editor, item);
        canIndent = $canIndentListItem(item);
        canOutdent = $canOutdentListItem(item);
      });
      if (itemKey == null) return;
      if (elems.length === 0 && fallbackLi) elems = [fallbackLi];
      if (elems.length === 0) return;

      const { clientX: startX, clientY: startY, pointerId } = down;
      let claimed = false;
      let lastDx = 0;

      const cleanup = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
        document.removeEventListener('touchmove', blockScroll);
        endGesture = null;
      };

      const onCancel = () => {
        if (claimed) clearTranslate(elems, true);
        cleanup();
      };

      const blockScroll = (event: TouchEvent) => event.preventDefault();

      const claim = () => {
        if (claimed) return;
        claimed = true;
        document.addEventListener('touchmove', blockScroll, { passive: false });
        try {
          root.setPointerCapture(pointerId);
        } catch {
          // synthetic pointers cannot be captured
        }
      };

      const visualDx = (dx: number) => {
        let next = dx;
        if (dx > 0 && !canIndent) next = dx * RUBBER_BAND;
        if (dx < 0 && !canOutdent) next = dx * RUBBER_BAND;
        return Math.max(-MAX_TRANSLATE_PX, Math.min(MAX_TRANSLATE_PX, next));
      };

      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== pointerId) return;
        const dx = move.clientX - startX;
        const dy = move.clientY - startY;
        lastDx = dx;
        if (!claimed) {
          if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return;
          // Mostly vertical: this is a scroll, abandon the gesture.
          if (Math.abs(dy) >= Math.abs(dx)) {
            cleanup();
            return;
          }
          claim();
        }
        setTranslate(elems, visualDx(dx));
      };

      const onUp = (up: PointerEvent) => {
        if (up.pointerId !== pointerId) return;
        cleanup();
        if (!claimed) return;

        const commitIndent = lastDx >= COMMIT_PX && canIndent;
        const commitOutdent = lastDx <= -COMMIT_PX && canOutdent;
        if (!commitIndent && !commitOutdent) {
          clearTranslate(elems, true);
          return;
        }

        clearTranslate(elems, false);
        const key = itemKey;
        const apply = commitIndent ? $indentListItem : $outdentListItem;
        // Apply after the pointer event so Lexical isn't mid-selection update.
        queueMicrotask(() => {
          editor.update(() => {
            const item = $getNodeByKey(key);
            if (!$isListItemNode(item)) return;
            apply(item);
          });
        });
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
      endGesture = onCancel;
    };

    // Capture on document so a parent stopPropagation cannot hide the swipe.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      endGesture?.();
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  };

  return editor.registerRootListener((root, prevRoot) => {
    if (prevRoot) {
      detachRoot?.();
      detachRoot = null;
    }
    if (root) detachRoot = attach(root);
  });
}

export function listSwipeIndentPlugin() {
  return (editor: LexicalEditor) => registerListSwipeIndent(editor);
}
