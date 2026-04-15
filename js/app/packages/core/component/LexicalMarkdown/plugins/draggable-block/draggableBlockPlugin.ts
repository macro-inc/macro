import { mergeRegister } from '@lexical/utils';
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  type LexicalEditor,
} from 'lexical';
import { createStore, type SetStoreFunction } from 'solid-js/store';

/** Custom MIME type to identify block drag operations in dataTransfer. */
export const DRAG_DATA_FORMAT = 'application/x-lexical-drag-block';

export type DraggableBlockState = {
  /** The top-level block element currently hovered by the mouse. */
  hoveredElement: HTMLElement | null;
  /** Whether a block drag is in progress. */
  isDragging: boolean;
  /** The block element under the cursor during a drag (drop zone). */
  targetElement: HTMLElement | null;
  /** Whether the dragged block would land before or after the target. */
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

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function getTopLevelNodeKeys(editor: LexicalEditor): string[] {
  return editor.getEditorState().read(() => $getRoot().getChildrenKeys());
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
 * Find the top-level block element whose vertical extent contains the given
 * clientY coordinate.  When {@link useEdgeAsDefault} is true, positions above
 * the first block or below the last block snap to those blocks respectively.
 */
function getBlockElement(
  editor: LexicalEditor,
  event: { clientY: number },
  useEdgeAsDefault = false
): HTMLElement | null {
  const topLevelNodeKeys = getTopLevelNodeKeys(editor);
  if (topLevelNodeKeys.length === 0) return null;

  let blockElem: HTMLElement | null = null;

  editor.getEditorState().read(() => {
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
        blockElem = elem;
        return;
      }
    }
  });

  return blockElem;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

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
  let currentDebugElem: HTMLElement | null = null; // DEBUG

  // -- Mouse tracking (hover detection) ------------------------------------
  // Attached to `document` so movement in the left margin (where the drag
  // handle sits) is still tracked.  We use the editor root rect to scope
  // the horizontal range: from 60 px left of the content to its right edge.

  const HORIZONTAL_BUFFER = 60;

  function onMouseMove(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      clearHover();
      return;
    }
    // Ignore mouse-moves while a button is held (text selection, etc.)
    if (event.buttons > 0) return;
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
    // DEBUG: highlight hovered element
    const prev = currentDebugElem;
    if (prev && prev !== blockElem) prev.style.background = '';
    if (blockElem) blockElem.style.background = 'yellow';
    currentDebugElem = blockElem;
    setState({ hoveredElement: blockElem });
  }

  function clearHover() {
    if (isDraggingBlock) return;
    // DEBUG: clear highlight
    if (currentDebugElem) {
      currentDebugElem.style.background = '';
      currentDebugElem = null;
    }
    setState({ hoveredElement: null });
  }

  // -- Drag event handlers -------------------------------------------------
  // Registered in the *capture* phase so that block-drags are intercepted
  // before the existing dragInsertPlugin (which listens in the bubble phase).

  function handleDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes(DRAG_DATA_FORMAT)) return;
    isDraggingBlock = true;

    event.preventDefault();
    event.stopImmediatePropagation();

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

      const targetNode = $getNearestNodeFromDOMNode(targetBlockElem);
      if (!targetNode) return;

      // Dropping on itself is a no-op.
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

  // -- Scroll handler (clear hover on scroll) ------------------------------

  function onScroll() {
    if (!isDraggingBlock) {
      setState({ hoveredElement: null });
    }
  }

  // -- State reset ---------------------------------------------------------

  function resetState() {
    setState({
      isDragging: false,
      targetElement: null,
      targetPosition: null,
      hoveredElement: null,
    });
  }

  // -- Listener management -------------------------------------------------

  // Drag listeners go on the anchor / root so drag events from within the
  // editor are captured.  Mouse-move goes on `document` so the margin area
  // (where the handle lives) is covered too.
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

  if (props.anchorElem) {
    attachDragListeners(props.anchorElem);
    return mergeRegister(
      () => detachDragListeners(props.anchorElem!),
      () => document.removeEventListener('mousemove', onMouseMove),
      () => window.removeEventListener('scroll', onScroll, true)
    );
  }

  // Fallback: attach drag listeners to the editor root element.
  return mergeRegister(
    editor.registerRootListener((root, prevRoot) => {
      if (root) attachDragListeners(root);
      if (prevRoot) detachDragListeners(prevRoot);
    }),
    () => document.removeEventListener('mousemove', onMouseMove),
    () => window.removeEventListener('scroll', onScroll, true)
  );
}

export const draggableBlockPlugin = (props: DraggableBlockPluginProps) => {
  return (editor: LexicalEditor) => registerDraggableBlock(editor, props);
};
