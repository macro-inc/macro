import {
  $computeTableMap,
  $isTableCellNode,
  $isTableRowNode,
  getDOMCellFromTarget,
} from '@lexical/table';
import {
  $getNearestNodeFromDOMNode,
  isHTMLElement,
  type LexicalEditor,
} from 'lexical';
import type { Accessor } from 'solid-js';
import {
  $deleteTableAtHover,
  $selectionDeleteExtent,
} from '../../plugins/tables/tableDelete';
import {
  cellDeletePixels,
  type TableDeleteHost,
  type TableDeletePixels,
} from './table-delete';

function readSelectionDeletePixels(
  editor: LexicalEditor,
  cellElem: HTMLElement,
  cellRect: DOMRect
): TableDeletePixels {
  const fallback = cellDeletePixels(cellRect);
  return editor.read(() => {
    const cellNode = $getNearestNodeFromDOMNode(cellElem);
    if (!$isTableCellNode(cellNode) || !cellNode.isAttached()) return fallback;
    const extent = $selectionDeleteExtent(cellNode);
    if (!extent) return fallback;

    const next = { ...fallback };
    if (extent.expandRows) {
      const minRowNode = extent.table.getChildAtIndex(extent.minRow);
      const maxRowNode = extent.table.getChildAtIndex(extent.maxRow);
      const minEl =
        minRowNode && $isTableRowNode(minRowNode)
          ? editor.getElementByKey(minRowNode.getKey())
          : null;
      const maxEl =
        maxRowNode && $isTableRowNode(maxRowNode)
          ? editor.getElementByKey(maxRowNode.getKey())
          : null;
      if (minEl && maxEl) {
        const minR = minEl.getBoundingClientRect();
        const maxR = maxEl.getBoundingClientRect();
        next.deleteRowTop = Math.min(minR.top, maxR.top);
        next.deleteRowBottom = Math.max(minR.bottom, maxR.bottom);
        next.selectedRowCount = extent.maxRow - extent.minRow + 1;
      }
    }
    if (extent.expandColumns) {
      const [map, pos] = $computeTableMap(extent.table, cellNode, cellNode);
      const minCell = map[pos.startRow]?.[extent.minColumn]?.cell;
      const maxCell = map[pos.startRow]?.[extent.maxColumn]?.cell;
      const minEl = minCell ? editor.getElementByKey(minCell.getKey()) : null;
      const maxEl = maxCell ? editor.getElementByKey(maxCell.getKey()) : null;
      if (minEl && maxEl) {
        const minR = minEl.getBoundingClientRect();
        const maxR = maxEl.getBoundingClientRect();
        next.deleteColLeft = Math.min(minR.left, maxR.left);
        next.deleteColRight = Math.max(minR.right, maxR.right);
        next.selectedColumnCount = extent.maxColumn - extent.minColumn + 1;
      }
    }
    return next;
  });
}

export function createLexicalTableDeleteHost(
  editor: Accessor<LexicalEditor | undefined>
): TableDeleteHost<{ element: HTMLElement }> {
  return {
    cellFromTarget(target) {
      if (!editor() || !isHTMLElement(target)) return null;
      const cell = getDOMCellFromTarget(target);
      return cell ? { element: cell.elem } : undefined;
    },
    selectionPixels(cell, rect) {
      const current = editor();
      return current
        ? readSelectionDeletePixels(current, cell.element, rect)
        : cellDeletePixels(rect);
    },
    deleteAt(cell, axis) {
      const current = editor();
      if (!current) return 'keep-target';
      current.update(() => {
        const node = $getNearestNodeFromDOMNode(cell.element);
        if (!$isTableCellNode(node) || !node.isAttached()) return;
        $deleteTableAtHover(node, axis);
      });
      return 'clear-target';
    },
    registerScroll(listener) {
      document.addEventListener('scroll', listener, {
        capture: true,
        passive: true,
      });
      return () =>
        document.removeEventListener('scroll', listener, { capture: true });
    },
    registerRoot(listener) {
      return editor()?.registerRootListener((root, previous) => {
        previous?.removeEventListener('pointermove', listener);
        root?.addEventListener('pointermove', listener);
      });
    },
  };
}
