import { $isTableCellNode, getDOMCellFromTarget } from '@lexical/table';
import { calculateZoomLevel } from '@lexical/utils';
import { $getNearestNodeFromDOMNode, type LexicalEditor } from 'lexical';
import type { Accessor } from 'solid-js';
import { registerEditorWidthObserver } from '../../plugins/shared/utils';
import {
  $applyResizeDrag,
  $applyRowResizeDrag,
  $captureResizeDrag,
  $captureRowResizeDrag,
  $revertResizeDrag,
  $revertRowResizeDrag,
} from '../../plugins/tables/tableCellResize';
import type { TableResizeDrag, TableResizeHost } from './table-resize';

export type LexicalTableResizeHit = {
  readonly element: HTMLElement;
  /** Set by pinCell for the duration of a drag. */
  readonly key?: string;
};

/**
 * A drag's live updates: the first pushes one history entry, the rest merge
 * into it so the whole drag undoes in a single step.
 */
function lexicalResizeDrag(
  editor: LexicalEditor,
  axis: TableResizeDrag['axis'],
  $apply: (delta: number) => void,
  $revert: () => void
): TableResizeDrag {
  let pushedHistory = false;
  return {
    axis,
    apply(delta) {
      const tag = pushedHistory
        ? ['skip-scroll-into-view', 'history-merge']
        : ['skip-scroll-into-view'];
      pushedHistory = true;
      editor.update(() => $apply(delta), { tag });
    },
    restore() {
      if (!pushedHistory) return;
      editor.update(() => $revert(), {
        tag: ['skip-scroll-into-view', 'history-merge'],
      });
    },
  };
}

export function createLexicalTableResizeHost(
  editor: Accessor<LexicalEditor | undefined>
): TableResizeHost<LexicalTableResizeHit> {
  return {
    cellFromTarget(target) {
      const cell = target instanceof Node ? getDOMCellFromTarget(target) : null;
      return cell ? { element: cell.elem } : undefined;
    },
    isEditable() {
      return !!editor()?.isEditable();
    },
    zoom(cell) {
      return calculateZoomLevel(cell.element);
    },
    beginDrag(cell, edge, zoom) {
      const current = editor();
      if (!current) return;
      if (edge === 'bottom') {
        const drag = current.read(() =>
          $captureRowResizeDrag(current, cell.element, zoom)
        );
        if (!drag) return;
        return lexicalResizeDrag(
          current,
          'row',
          (delta) => $applyRowResizeDrag(drag, delta),
          () => $revertRowResizeDrag(drag)
        );
      }
      const drag = current.read(() =>
        $captureResizeDrag(current, cell.element, edge, zoom)
      );
      if (!drag) return;
      return lexicalResizeDrag(
        current,
        'column',
        (delta) => $applyResizeDrag(drag, delta),
        () => $revertResizeDrag(drag)
      );
    },
    pinCell(cell) {
      const key = editor()?.read(() => {
        const node = $getNearestNodeFromDOMNode(cell.element);
        return $isTableCellNode(node) ? node.getKey() : undefined;
      });
      return key === undefined ? undefined : { element: cell.element, key };
    },
    elementFor(cell) {
      return (cell.key && editor()?.getElementByKey(cell.key)) || undefined;
    },
    registerRoot(listeners) {
      let cleanupRoot: (() => void) | null = null;
      const removeRootListener = editor()?.registerRootListener((root) => {
        cleanupRoot?.();
        cleanupRoot = null;
        if (!root) return;
        root.addEventListener('pointermove', listeners.pointermove);
        root.addEventListener('pointerdown', listeners.pointerdown);
        cleanupRoot = () => {
          root.removeEventListener('pointermove', listeners.pointermove);
          root.removeEventListener('pointerdown', listeners.pointerdown);
        };
      });
      return () => {
        removeRootListener?.();
        cleanupRoot?.();
      };
    },
    registerLayout(listener) {
      const removeUpdateListener = editor()?.registerUpdateListener(listener);
      let cleanupWidthObserver = () => {};
      const widthObserverEditor = editor();
      if (widthObserverEditor) {
        cleanupWidthObserver = registerEditorWidthObserver(
          widthObserverEditor,
          listener
        );
      }
      return () => {
        removeUpdateListener?.();
        cleanupWidthObserver();
      };
    },
  };
}
