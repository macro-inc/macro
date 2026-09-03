/**
 * @file Touch cell selection for tables: long-press a cell to select it, then
 * swipe in any direction to extend the selection cell-by-cell. Mouse/pen
 * drags already do this via @lexical/table's own pointer handlers, but a
 * finger that starts moving right away is scrolling, so those handlers are
 * kept away from touch entirely by `tableTouchDragGuard`. Long-press is the
 * disambiguator: a finger that hasn't moved by then isn't scrolling, so from
 * that point the gesture is ours to keep (a non-passive touchmove listener
 * blocks the pan) and the selection is driven through the same TableObserver
 * the desktop drag uses.
 */
import {
  getDOMCellFromTarget,
  getTableObserverFromTableElement,
  type TableDOMCell,
} from '@lexical/table';
import type { LexicalEditor } from 'lexical';

// Must beat the native long-press UI (iOS loupe / Android context menu,
// both around 500ms) so the gesture is ours before the OS reacts.
const LONG_PRESS_MS = 400;
// Finger drift beyond this before the timer fires means a scroll, not a press.
const SLOP_PX = 10;

function registerTableTouchSelection(editor: LexicalEditor): () => void {
  // True from touch-down on a cell until the gesture ends; used to swallow
  // the context menu Android fires on long-press.
  let gestureActive = false;
  let endGesture: (() => void) | null = null;

  const attach = (root: HTMLElement): (() => void) => {
    const onPointerDown = (down: PointerEvent) => {
      if (down.pointerType !== 'touch' || !down.isPrimary) return;
      if (!editor.isEditable()) return;
      endGesture?.();

      const domCell =
        down.target instanceof Node ? getDOMCellFromTarget(down.target) : null;
      const tableElem = domCell?.elem.closest('table');
      if (!domCell || !tableElem) return;

      const observer = getTableObserverFromTableElement(
        tableElem as Parameters<typeof getTableObserverFromTableElement>[0]
      );
      if (!observer) return;

      gestureActive = true;
      const { clientX: startX, clientY: startY, pointerId } = down;
      let timer = 0;

      const cleanupArmed = () => {
        window.clearTimeout(timer);
        document.removeEventListener('pointermove', onArmedMove);
        document.removeEventListener('pointerup', cancelArmed);
        document.removeEventListener('pointercancel', cancelArmed);
      };
      const cancelArmed = () => {
        cleanupArmed();
        gestureActive = false;
        endGesture = null;
      };
      const onArmedMove = (move: PointerEvent) => {
        if (move.pointerId !== pointerId) return;
        const drift = Math.hypot(move.clientX - startX, move.clientY - startY);
        if (drift > SLOP_PX) cancelArmed();
      };

      const startSelecting = () => {
        // The native selection UI (iOS text loupe) would fight the cell
        // selection from here on; suppress it for the rest of the gesture.
        tableElem.style.setProperty('-webkit-user-select', 'none');
        tableElem.style.setProperty('-webkit-touch-callout', 'none');
        navigator.vibrate?.(10);

        editor.update(() => {
          observer.$setAnchorCellForSelection(domCell);
          // ignoreStart forces the single-cell highlight immediately instead
          // of waiting for the finger to leave the first cell.
          observer.$setFocusCellForSelection(domCell, true);
        });

        let lastFocusElem = domCell.elem;

        // pointermove can't stop the page from panning; only preventDefault
        // from a non-passive touchmove listener can.
        const blockScroll = (event: TouchEvent) => event.preventDefault();

        const onSelectMove = (move: PointerEvent) => {
          if (move.pointerId !== pointerId) return;
          let focusCell: TableDOMCell | null = null;
          for (const el of document.elementsFromPoint(
            move.clientX,
            move.clientY
          )) {
            const cell = getDOMCellFromTarget(el);
            if (cell && tableElem.contains(cell.elem)) {
              focusCell = cell;
              break;
            }
          }
          if (!focusCell || focusCell.elem === lastFocusElem) return;
          lastFocusElem = focusCell.elem;
          const focus = focusCell;
          editor.update(() => {
            observer.$setFocusCellForSelection(focus, true);
          });
        };

        const endSelecting = () => {
          document.removeEventListener('pointermove', onSelectMove);
          document.removeEventListener('pointerup', endSelecting);
          document.removeEventListener('pointercancel', endSelecting);
          document.removeEventListener('touchmove', blockScroll);
          tableElem.style.removeProperty('-webkit-user-select');
          tableElem.style.removeProperty('-webkit-touch-callout');
          gestureActive = false;
          endGesture = null;
        };

        document.addEventListener('pointermove', onSelectMove);
        document.addEventListener('pointerup', endSelecting);
        document.addEventListener('pointercancel', endSelecting);
        document.addEventListener('touchmove', blockScroll, { passive: false });
        endGesture = endSelecting;
      };

      timer = window.setTimeout(() => {
        cleanupArmed();
        startSelecting();
      }, LONG_PRESS_MS);

      document.addEventListener('pointermove', onArmedMove);
      document.addEventListener('pointerup', cancelArmed);
      document.addEventListener('pointercancel', cancelArmed);
      endGesture = cancelArmed;
    };

    const onContextMenu = (event: Event) => {
      if (gestureActive) event.preventDefault();
    };

    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('contextmenu', onContextMenu);
    return () => {
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('contextmenu', onContextMenu);
      endGesture?.();
    };
  };

  let cleanupRoot: (() => void) | null = null;
  const removeRootListener = editor.registerRootListener((root) => {
    cleanupRoot?.();
    cleanupRoot = root ? attach(root) : null;
  });

  return () => {
    removeRootListener();
    cleanupRoot?.();
    cleanupRoot = null;
  };
}

export function tableTouchSelectionPlugin() {
  return (editor: LexicalEditor) => registerTableTouchSelection(editor);
}
