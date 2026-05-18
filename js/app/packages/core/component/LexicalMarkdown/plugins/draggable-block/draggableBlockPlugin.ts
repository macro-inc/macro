import {
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListItemNode,
} from '@lexical/list';
import { mergeRegister } from '@lexical/utils';
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import { createStore, type SetStoreFunction } from 'solid-js/store';

export const DRAG_DATA_FORMAT = 'application/x-lexical-drag-block';

export type DraggableBlockState = {
  hoveredElement: HTMLElement | null;
  isDragging: boolean;
  targetElement: HTMLElement | null;
  targetPosition: 'before' | 'after' | null;
};

export const createDraggableBlockStore = () => {
  return createStore<DraggableBlockState>({
    hoveredElement: null,
    isDragging: false,
    targetElement: null,
    targetPosition: null,
  });
};

function getTopLevelNodeKeys(editor: LexicalEditor): string[] {
  return editor.read(() => $getRoot().getChildrenKeys());
}

function getCollapsedMargins(elem: HTMLElement): {
  marginTop: number;
  marginBottom: number;
} {
  const getMargin = (
    element: Element | null,
    margin: 'marginTop' | 'marginBottom'
  ): number =>
    element ? parseFloat(window.getComputedStyle(element)[margin]) : 0;

  const { marginTop, marginBottom } = window.getComputedStyle(elem);
  const prevSiblingMarginBottom = getMargin(
    elem.previousElementSibling,
    'marginBottom'
  );
  const nextSiblingMarginTop = getMargin(elem.nextElementSibling, 'marginTop');

  return {
    marginTop: Math.max(parseFloat(marginTop), prevSiblingMarginBottom),
    marginBottom: Math.max(parseFloat(marginBottom), nextSiblingMarginTop),
  };
}

/**
 * Given a list DOM element, find the `<li>` child closest to clientY. Uses
 * midpoint-distance so there are no dead zones between items.
 */
function $getListItemElement(
  editor: LexicalEditor,
  listElem: HTMLElement,
  clientY: number
): HTMLElement | null {
  const listNode = $getNearestNodeFromDOMNode(listElem);
  if (!listNode || !$isListNode(listNode)) return null;

  let closest: HTMLElement | null = null;
  let closestDist = Infinity;
  // Track the last "real" item (one with actual content, not just a nesting
  // wrapper) so we can normalize wrapper hits.
  let lastRealLi: HTMLElement | null = null;
  let closestIsWrapper = false;

  for (const child of listNode.getChildren()) {
    if (!$isListItemNode(child)) continue;
    const li = editor.getElementByKey(child.getKey());
    if (!li) continue;

    const isWrapper =
      child.getChildren().length > 0 &&
      child.getChildren().every((c) => $isListNode(c));

    const rect = li.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const dist = Math.abs(clientY - mid);

    if (!isWrapper) lastRealLi = li;

    if (dist < closestDist) {
      closestDist = dist;
      closest = li;
      closestIsWrapper = isWrapper;
    }
  }

  // If the closest hit is a nesting wrapper, return the preceding real item
  // instead so the handle targets the logical owner of that nested content.
  if (closestIsWrapper && lastRealLi) return lastRealLi;
  return closest;
}

/**
 * Find the draggable element at the given clientY coordinate.
 *
 * For most blocks this is the top-level element.  For lists we drill into the
 * `<li>` items so individual list items can be reordered.
 *
 * When useEdgeAsDefault is true, positions above the first block or
 * below the last block snap to those blocks respectively.
 */
function getBlockElement(
  editor: LexicalEditor,
  event: { clientY: number },
  useEdgeAsDefault = false
): HTMLElement | null {
  const topLevelNodeKeys = getTopLevelNodeKeys(editor);
  if (topLevelNodeKeys.length === 0) return null;

  let blockElem: HTMLElement | null = null;

  editor.read(() => {
    if (useEdgeAsDefault) {
      const firstElem = editor.getElementByKey(topLevelNodeKeys[0]);
      const lastElem = editor.getElementByKey(
        topLevelNodeKeys[topLevelNodeKeys.length - 1]
      );
      if (firstElem && event.clientY < firstElem.getBoundingClientRect().top) {
        blockElem = firstElem;
        return;
      }
      if (lastElem && event.clientY > lastElem.getBoundingClientRect().bottom) {
        blockElem = lastElem;
        return;
      }
    }

    for (const key of topLevelNodeKeys) {
      const elem = editor.getElementByKey(key);
      if (!elem) continue;

      const rect = elem.getBoundingClientRect();
      const { marginTop, marginBottom } = getCollapsedMargins(elem);

      if (
        event.clientY >= rect.top - marginTop &&
        event.clientY <= rect.bottom + marginBottom
      ) {
        // If this is a list, drill into its items.
        const node = $getNodeByKey(key);
        if (node && $isListNode(node)) {
          const li = $getListItemElement(editor, elem, event.clientY);
          if (li) {
            blockElem = li;
            return;
          }
        }
        blockElem = elem;
        return;
      }
    }
  });

  return blockElem;
}

/**
 * Collect a ListItemNode together with any immediately following siblings that
 * represent nested content.  Exported for use by the drag-handle component.
 *
 * Handles two nesting strategies:
 *
 * 1. **Flat-indent** — siblings with a higher `getIndent()` value.
 * 2. **Tree-nesting** — a sibling ListItemNode whose only children are
 *    ListNodes (a "nesting wrapper" with no text of its own).
 *
 * Must be called inside an editor.update() context.
 */
export function $collectNestedGroup(item: ListItemNode): ListItemNode[] {
  const indent = item.getIndent();
  const group: ListItemNode[] = [item];
  let sibling = item.getNextSibling();

  while (sibling && $isListItemNode(sibling)) {
    const sib = sibling as ListItemNode;

    // Flat-indent: higher indent means nested under us.
    if (sib.getIndent() > indent) {
      group.push(sib);
      sibling = sib.getNextSibling();
      continue;
    }

    // Tree-nesting: a ListItemNode whose only children are ListNodes is a
    // wrapper that holds nested content for the previous item.
    const children = sib.getChildren();
    if (children.length > 0 && children.every((c) => $isListNode(c))) {
      group.push(sib);
      sibling = sib.getNextSibling();
      continue;
    }

    break;
  }
  return group;
}

export type DraggableBlockPluginProps = {
  setState: SetStoreFunction<DraggableBlockState>;
  /**
   * Element to listen for mouse / drag events on.
   * Falls back to the Lexical root element when omitted.
   */
  anchorElem?: HTMLElement;
};

function registerDraggableBlock(
  editor: LexicalEditor,
  props: DraggableBlockPluginProps
) {
  const { setState } = props;
  let isDraggingBlock = false;
  let isKeyboardMode = false;
  let hasNonCollapsedSelection = false;
  let rafId: number | null = null;
  let latestMouseEvent: MouseEvent | null = null;

  // Attached to `document` so movement in the left margin (where the drag
  // handle sits) is still tracked.  We use the editor root rect to scope
  // the horizontal range: from 60 px left of the content to its right edge.
  const HORIZONTAL_BUFFER = 60;

  function processMouseMove(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      clearHover();
      return;
    }
    // Ignore mouse-moves while a button is held (text selection, etc.)
    if (event.buttons > 0) return;

    // Hide drag menu if there's a non-collapsed range selection
    if (hasNonCollapsedSelection) {
      clearHover();
      return;
    }

    // Keep the current hover while the cursor sits on the drag handle itself.
    if (target.closest('.draggable-block-menu')) return;

    // Only react when the cursor is horizontally near the editor.
    const rootRect = editor.getRootElement()?.getBoundingClientRect();
    if (rootRect) {
      const inXRange =
        event.clientX >= rootRect.left - HORIZONTAL_BUFFER &&
        event.clientX <= rootRect.right;
      const inYRange =
        event.clientY >= rootRect.top && event.clientY <= rootRect.bottom;
      if (!inXRange || !inYRange) {
        clearHover();
        return;
      }
    }

    const blockElem = getBlockElement(editor, event);
    setState({ hoveredElement: blockElem });
  }

  function onMouseMove(event: MouseEvent) {
    if (isKeyboardMode) {
      isKeyboardMode = false;
    }

    latestMouseEvent = event;

    if (rafId !== null) return;

    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (latestMouseEvent) {
        processMouseMove(latestMouseEvent);
        latestMouseEvent = null;
      }
    });
  }

  function clearHover() {
    if (isDraggingBlock) return;
    setState({ hoveredElement: null });
  }

  // Keyboard handlers (hide on typing)
  function handleKeyboardInput() {
    if (!isKeyboardMode) {
      isKeyboardMode = true;
      setState({ hoveredElement: null });
    }
    return false;
  }

  function handleDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes(DRAG_DATA_FORMAT)) return;
    isDraggingBlock = true;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    const targetBlockElem = getBlockElement(editor, event, true);
    if (!targetBlockElem) {
      setState({ targetElement: null, targetPosition: null });
      return;
    }

    const targetRect = targetBlockElem.getBoundingClientRect();
    const insertBefore = event.clientY < targetRect.top + targetRect.height / 2;

    setState({
      targetElement: targetBlockElem,
      targetPosition: insertBefore ? 'before' : 'after',
    });
  }

  function handleDrop(event: DragEvent) {
    const dragData = event.dataTransfer?.getData(DRAG_DATA_FORMAT);
    if (!dragData) return;

    isDraggingBlock = false;
    event.preventDefault();
    event.stopImmediatePropagation();

    const targetBlockElem = getBlockElement(editor, event, true);
    if (!targetBlockElem) {
      resetState();
      return;
    }

    const targetRect = targetBlockElem.getBoundingClientRect();
    const insertBefore = event.clientY < targetRect.top + targetRect.height / 2;

    editor.update(() => {
      const draggedNode = $getNodeByKey(dragData);
      if (!draggedNode) return;

      let targetNode = $getNearestNodeFromDOMNode(targetBlockElem);
      if (!targetNode) return;

      if (targetNode === draggedNode) return;

      const draggedParent = draggedNode.getParent();
      const targetParent = $isListItemNode(targetNode)
        ? targetNode.getParent()
        : null;

      // Same-list reorder. Both nodes are ListItemNodes sharing the same
      // ListNode parent.
      if (
        $isListItemNode(draggedNode) &&
        $isListItemNode(targetNode) &&
        draggedParent &&
        draggedParent === targetParent
      ) {
        const group = $collectNestedGroup(draggedNode as ListItemNode);

        // Dropping onto a member of the dragged group is a no-op —
        // prevents detaching nested subtrees from their logical parent.
        const groupKeys = new Set(group.map((n) => n.getKey()));
        if (groupKeys.has(targetNode.getKey())) return;

        if (insertBefore) {
          // Insert the whole group before the target, preserving order.
          for (const item of group) {
            targetNode.insertBefore(item);
          }
        } else {
          // Insert the whole group after the target, preserving order.
          // Walk backwards so each insertAfter stacks correctly.
          let anchor = targetNode;
          for (const item of group) {
            anchor.insertAfter(item);
            anchor = item;
          }
        }
        return;
      }

      // List-item extracted to root level. A ListItemNode dragged outside its
      // parent list needs to be wrapped in a fresh ListNode of the same type.
      if (
        $isListItemNode(draggedNode) &&
        draggedParent &&
        $isListNode(draggedParent)
      ) {
        const group = $collectNestedGroup(draggedNode as ListItemNode);
        const listType = draggedParent.getListType();
        const newList = $createListNode(listType);
        for (const item of group) {
          newList.append(item);
        }

        // Resolve the insertion target to a top-level node when the
        // cursor is over a list item in a *different* list.
        let insertTarget = targetNode;
        if (
          $isListItemNode(targetNode) &&
          targetParent &&
          $isListNode(targetParent)
        ) {
          insertTarget = targetParent;
        }

        if (insertBefore) {
          insertTarget.insertBefore(newList);
        } else {
          insertTarget.insertAfter(newList);
        }

        // Remove the source list if it's now empty.
        if (draggedParent.getChildrenSize() === 0) {
          draggedParent.remove();
        }
        return;
      }

      // Non-list block dropped onto a list item → split the list
      if (
        !$isListItemNode(draggedNode) &&
        $isListItemNode(targetNode) &&
        targetParent &&
        $isListNode(targetParent)
      ) {
        const listNode = targetParent;
        const children = listNode.getChildren();
        const listType = listNode.getListType();

        // Determine the split index.  When inserting after the target,
        // include any nesting-wrapper siblings that belong to it.
        const targetGroup = $collectNestedGroup(targetNode as ListItemNode);
        const lastInGroup = targetGroup[targetGroup.length - 1];
        const splitIndex = insertBefore
          ? targetNode.getIndexWithinParent()
          : lastInGroup.getIndexWithinParent() + 1;

        const beforeItems = children.slice(0, splitIndex);
        const afterItems = children.slice(splitIndex);

        // Build the "before" list (items above the split).
        if (beforeItems.length > 0) {
          const beforeList = $createListNode(listType);
          for (const item of beforeItems) beforeList.append(item);
          listNode.insertBefore(beforeList);
        }

        // Insert the dragged block at the split point.
        listNode.insertBefore(draggedNode);

        // Build the "after" list (items below the split).
        if (afterItems.length > 0) {
          const afterList = $createListNode(listType);
          for (const item of afterItems) afterList.append(item);
          listNode.insertBefore(afterList);
        }

        // Remove the now-empty original list.
        listNode.remove();
        return;
      }

      // Default: top-level block move
      if (
        $isListItemNode(targetNode) &&
        targetParent &&
        $isListNode(targetParent)
      ) {
        targetNode = targetParent;
      }

      if (targetNode === draggedNode) return;

      if (insertBefore) {
        targetNode.insertBefore(draggedNode);
      } else {
        targetNode.insertAfter(draggedNode);
      }
    });

    resetState();
  }

  function handleDragEnd() {
    if (isDraggingBlock) {
      isDraggingBlock = false;
      resetState();
    }
  }

  function onScroll() {
    if (!isDraggingBlock) {
      setState({ hoveredElement: null });
    }
  }

  function resetState() {
    setState({
      isDragging: false,
      targetElement: null,
      targetPosition: null,
      hoveredElement: null,
    });
  }

  function attachDragListeners(elem: HTMLElement) {
    elem.addEventListener('dragover', handleDragOver, true);
    elem.addEventListener('drop', handleDrop, true);
    elem.addEventListener('dragend', handleDragEnd, true);
  }

  function detachDragListeners(elem: HTMLElement) {
    elem.removeEventListener('dragover', handleDragOver, true);
    elem.removeEventListener('drop', handleDrop, true);
    elem.removeEventListener('dragend', handleDragEnd, true);
  }

  document.addEventListener('mousemove', onMouseMove);
  window.addEventListener('scroll', onScroll, true);

  // Hide drag handle when any key is pressed
  const unregisterKeyDown = editor.registerCommand(
    KEY_DOWN_COMMAND,
    () => {
      handleKeyboardInput();
      return false;
    },
    COMMAND_PRIORITY_HIGH
  );

  // Hide drag handle when there's a non-collapsed selection
  const unregisterSelectionChange = editor.registerCommand(
    SELECTION_CHANGE_COMMAND,
    () => {
      const selection = $getSelection();
      hasNonCollapsedSelection =
        $isRangeSelection(selection) && !selection.isCollapsed();
      if (hasNonCollapsedSelection) {
        clearHover();
      }
      return false;
    },
    COMMAND_PRIORITY_HIGH
  );

  function cleanup() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    document.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('scroll', onScroll, true);
    unregisterKeyDown();
    unregisterSelectionChange();
  }

  if (props.anchorElem) {
    attachDragListeners(props.anchorElem);
    return mergeRegister(() => detachDragListeners(props.anchorElem!), cleanup);
  }

  // Fallback: attach drag listeners to the editor root element.
  return mergeRegister(
    editor.registerRootListener((root, prevRoot) => {
      if (root) attachDragListeners(root);
      if (prevRoot) detachDragListeners(prevRoot);
    }),
    cleanup
  );
}

export const draggableBlockPlugin = (props: DraggableBlockPluginProps) => {
  return (editor: LexicalEditor) => registerDraggableBlock(editor, props);
};
