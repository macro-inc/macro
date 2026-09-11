/**
 * @file Apple Notes-style swipe indent for list items on touch.
 *
 * A mostly-horizontal finger swipe on a list row indents (right) or outdents
 * (left) that item one level on release, taking nested children with it.
 * Items stay still while the finger is down. Vertical pans
 * stay scrolling; taps and mouse drags are left alone. The first item can
 * indent without a preceding sibling; other items keep the same sibling
 * depth limit as tab indentation.
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
} from 'lexical';
import { $collectNestedGroup } from '../draggable-block/draggableBlockPlugin';

/** Movement below this is a tap or scroll jitter, not a swipe. */
const SLOP_PX = 12;
/** Release past this distance commits one indent/outdent. */
const COMMIT_PX = 40;
/** Ignore swipes that start on the iOS back-gesture edge. */
const EDGE_GUARD_PX = 16;

export function $canIndentListItem(item: ListItemNode): boolean {
  if (!item.canIndent()) return false;
  const prev = item.getPreviousSibling();
  if (prev === null) return true;
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
  while (true) {
    const child = current.getFirstChild();
    if (!$isListNode(child)) break;
    const inner = child.getFirstChild();
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
  if (parent.getChildrenSize() === 0) {
    parent.remove();
    if (grand.getChildrenSize() === 0) grand.remove();
  }
  return true;
}

/** Keep child-list wrappers out of Lexical's single-item split/merge operation. */
function $moveWithNestedGroup(
  item: ListItemNode,
  move: () => boolean
): boolean {
  const parent = item.getParent();
  if (!$isListNode(parent)) return false;
  const nested = $collectNestedGroup(item).slice(1);
  if (nested.length === 0) return move();

  // Moving into a temporary list preserves the nodes and their selection points.
  // Leaving wrappers beside the item lets setIndent merge their children into
  // the destination list as siblings, losing their relationship to this item.
  $createListNode(parent.getListType()).append(...nested);
  const moved = move();
  let anchor = item;
  for (const node of nested) {
    anchor.insertAfter(node);
    anchor = node;
  }
  return moved;
}

/** Indent a list item and its nested group by one level. */
export function $indentListItem(item: ListItemNode): boolean {
  const target = $unwrapNestedListItem(item);
  if (!$canIndentListItem(target)) return false;
  return $moveWithNestedGroup(target, () => {
    const before = target.getIndent();
    target.setIndent(before + 1);
    return target.getIndent() > before || $nestUnderPreviousSibling(target);
  });
}

/** Outdent a list item and its nested group by one level. */
export function $outdentListItem(item: ListItemNode): boolean {
  const target = $unwrapNestedListItem(item);
  if (!$canOutdentListItem(target)) return false;
  return $moveWithNestedGroup(target, () => {
    const before = target.getIndent();
    target.setIndent(before - 1);
    return target.getIndent() < before || $unnestFromParentList(target);
  });
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

function registerListSwipeIndent(
  editor: LexicalEditor,
  isInteractable: () => boolean
): () => void {
  let endGesture: (() => void) | null = null;
  let detachRoot: (() => void) | null = null;

  const attach = (root: HTMLElement): (() => void) => {
    const onPointerDown = (down: PointerEvent) => {
      if (down.pointerType !== 'touch') return;
      if (down.isPrimary === false) return;
      if (!isInteractable() || !editor.isEditable()) return;
      if (down.clientX < EDGE_GUARD_PX) return;
      const eventTarget = down.target;
      if (!(eventTarget instanceof Node) || !root.contains(eventTarget)) return;
      endGesture?.();

      let canIndent = false;
      let canOutdent = false;

      const itemKey = editor.read(() => {
        const item = listItemFromTarget(eventTarget);
        if (!item) return null;
        canIndent = $canIndentListItem(item);
        canOutdent = $canOutdentListItem(item);
        return item.getKey();
      });
      if (itemKey == null) return;

      const { clientX: startX, clientY: startY, pointerId } = down;
      let claimed = false;
      let lastDx = 0;

      const cleanup = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', cleanup);
        document.removeEventListener('touchmove', blockScroll);
        endGesture = null;
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
      };

      const onUp = (up: PointerEvent) => {
        if (up.pointerId !== pointerId) return;
        cleanup();
        if (!claimed) return;

        const commitIndent = lastDx >= COMMIT_PX && canIndent;
        const commitOutdent = lastDx <= -COMMIT_PX && canOutdent;
        if (!commitIndent && !commitOutdent) return;

        const key = itemKey;
        const apply = commitIndent ? $indentListItem : $outdentListItem;
        // Apply after the pointer event so Lexical isn't mid-selection update.
        queueMicrotask(() => {
          if (!isInteractable() || !editor.isEditable()) return;
          editor.update(() => {
            const item = $getNodeByKey(key);
            if (!$isListItemNode(item)) return;
            apply(item);
          });
        });
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', cleanup);
      endGesture = cleanup;
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

/** isInteractable must represent permission to edit content, not to comment. */
export function listSwipeIndentPlugin(isInteractable: () => boolean) {
  return (editor: LexicalEditor) =>
    registerListSwipeIndent(editor, isInteractable);
}
