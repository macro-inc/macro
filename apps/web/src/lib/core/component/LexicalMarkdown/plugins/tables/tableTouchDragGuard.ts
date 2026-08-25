/**
 * @file A touch drag across cells must never select them. @lexical/table
 * starts a drag selection from the first pointermove after any pointerdown on
 * a cell, and a finger in contact with the screen reports the primary button
 * as pressed, so its window-level handler treats a plain scroll over a table
 * as a drag and lights up every cell the finger passes. Touch selection is
 * instead owned by the long-press gesture in `tableTouchSelection`, so this
 * guard keeps touch pointermove from reaching that window handler for the
 * whole gesture. Mouse and pen are untouched: dragging still selects.
 *
 * Stopping propagation on the document leaves other document-level listeners
 * (the cell resizer's, the long-press gesture's) intact — only the window
 * listeners further up the path are cut off.
 */
import { getDOMCellFromTarget } from '@lexical/table';
import type { LexicalEditor } from 'lexical';

export function registerTableTouchDragGuard(editor: LexicalEditor): () => void {
  let endGesture: (() => void) | null = null;

  const attach = (root: HTMLElement): (() => void) => {
    const onPointerDown = (down: PointerEvent) => {
      if (down.pointerType !== 'touch' || !down.isPrimary) return;
      endGesture?.();

      const onCell =
        down.target instanceof Node && getDOMCellFromTarget(down.target);
      if (!onCell) return;

      const { pointerId } = down;

      const swallowMove = (move: PointerEvent) => {
        if (move.pointerId === pointerId) move.stopPropagation();
      };

      const end = () => {
        document.removeEventListener('pointermove', swallowMove);
        document.removeEventListener('pointerup', end);
        document.removeEventListener('pointercancel', end);
        endGesture = null;
      };

      document.addEventListener('pointermove', swallowMove);
      document.addEventListener('pointerup', end);
      document.addEventListener('pointercancel', end);
      endGesture = end;
    };

    root.addEventListener('pointerdown', onPointerDown);
    return () => {
      root.removeEventListener('pointerdown', onPointerDown);
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
