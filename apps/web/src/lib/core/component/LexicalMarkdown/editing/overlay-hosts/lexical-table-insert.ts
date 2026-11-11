import {
  $computeTableMapSkipCellCheck,
  $getTableNodeFromLexicalNodeOrThrow,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  getDOMCellFromTarget,
  getTableElement,
} from '@lexical/table';
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  isHTMLElement,
  type LexicalEditor,
} from 'lexical';
import type { Accessor } from 'solid-js';
import type { TableInsertHost } from './table-insert';

export function createLexicalTableInsertHost(
  editor: Accessor<LexicalEditor | undefined>
): TableInsertHost<string, { element: HTMLElement; editor: LexicalEditor }> {
  return {
    cellFromTarget(target) {
      const current = editor();
      if (!current || !isHTMLElement(target)) return null;
      const cell = getDOMCellFromTarget(target);
      return cell ? { element: cell.elem, editor: current } : undefined;
    },
    referenceForBorder(cell, axis, side) {
      const current = cell.editor;
      return current.read(() => {
        const node = $getNearestNodeFromDOMNode(cell.element);
        if (!$isTableCellNode(node)) return;
        const table = $getTableNodeFromLexicalNodeOrThrow(node);
        let reference = node;
        if (side === 'start') {
          const [map, origin] = $computeTableMapSkipCellCheck(
            table,
            node,
            null
          );
          if (!origin) return;
          const previous =
            axis === 'row'
              ? origin.startRow > 0
                ? map[origin.startRow - 1][origin.startColumn]
                : undefined
              : origin.startColumn > 0
                ? map[origin.startRow][origin.startColumn - 1]
                : undefined;
          if (!previous) return;
          reference = previous.cell;
        }
        const element = getTableElement(
          table,
          current.getElementByKey(table.getKey())
        );
        if (!element) return;
        return { key: reference.getKey(), table: element };
      });
    },
    insertAfter(key, axis) {
      const current = editor();
      if (!current) return 'keep-target';
      current.update(() => {
        const cell = $getNodeByKey(key);
        if (!$isTableCellNode(cell) || !cell.isAttached()) return;
        cell.selectStart();
        if (axis === 'row') {
          const row = $insertTableRowAtSelection(true);
          const first = row?.getFirstChild();
          if ($isTableCellNode(first)) first.selectStart();
        } else {
          $insertTableColumnAtSelection(true);
        }
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
