import {
  $computeTableMap,
  $createTableSelection,
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $getTableCellNodeFromLexicalNode,
  $getTableNodeFromLexicalNodeOrThrow,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  $isTableSelection,
  $unmergeCell,
  getDOMCellFromTarget,
  type TableCellNode,
} from '@lexical/table';
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  BLUR_COMMAND,
  COMMAND_PRIORITY_LOW,
  FOCUS_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  mergeRegister,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import { lazyRegister } from '../../plugins';
import { $moveCellRange } from '../../plugins/tables/tableMove';
import type {
  TableMoveCells,
  TableMoveHost,
  TableMoveMenuAction,
  TableMoveShape,
} from './table-move';

const isMergedCell = (cell: TableCellNode) =>
  cell.getColSpan() > 1 || cell.getRowSpan() > 1;

/** Both tracked cells as attached table cells, or undefined. */
function $trackedCellNodes(cells: TableMoveCells<string> | undefined) {
  const anchorCell = cells?.anchor ? $getNodeByKey(cells.anchor) : null;
  const focusCell = cells?.focus ? $getNodeByKey(cells.focus) : null;
  if (
    !$isTableCellNode(anchorCell) ||
    !$isTableCellNode(focusCell) ||
    !anchorCell.isAttached() ||
    !focusCell.isAttached()
  ) {
    return;
  }
  return { anchorCell, focusCell };
}

function $runMenuAction(action: TableMoveMenuAction, cell: TableCellNode) {
  match(action)
    .with('insert-column-left', () => $insertTableColumnAtSelection(false))
    .with('insert-column-right', () => $insertTableColumnAtSelection(true))
    .with('insert-row-below', () => $insertTableRowAtSelection(true))
    .with('insert-row-above', () => $insertTableRowAtSelection(false))
    .with('delete-row', () => $deleteTableRowAtSelection())
    .with('delete-column', () => $deleteTableColumnAtSelection())
    .with('split-cell', () => $unmergeCell())
    .with('delete-table', () =>
      $getTableNodeFromLexicalNodeOrThrow(cell).remove()
    )
    .exhaustive();
}

function trackedFrom(
  anchorCell: TableCellNode | null,
  focusCell: TableCellNode | null
): TableMoveCells<string> {
  // Source sets each corner independently; merged comes from the anchor alone.
  return {
    anchor: anchorCell?.getKey(),
    focus: focusCell?.getKey(),
    merged: !!anchorCell && isMergedCell(anchorCell),
  };
}

const cellOf = (node: LexicalNode | null) =>
  node ? $getTableCellNodeFromLexicalNode(node) : null;

/**
 * Source TableMoveHandle backend. Its Lexical listeners register once, in
 * Source order, through one lazyRegister owned by the calling component.
 */
export function createLexicalTableMoveHost(
  editor: Accessor<LexicalEditor | undefined>
): TableMoveHost<string> {
  const selectionListeners = new Set<() => void>();
  const layoutListeners = new Set<() => void>();
  const focusListeners = new Set<(focused: boolean) => void>();
  const notifyFocus = (focused: boolean) => {
    for (const listener of focusListeners) listener(focused);
    return false;
  };

  lazyRegister(editor, (e) => {
    return mergeRegister(
      e.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          for (const listener of selectionListeners) listener();
          return false;
        },
        COMMAND_PRIORITY_LOW
      ),
      e.registerUpdateListener(() => {
        for (const listener of layoutListeners) listener();
      }),
      e.registerCommand(
        FOCUS_COMMAND,
        () => notifyFocus(true),
        COMMAND_PRIORITY_LOW
      ),
      e.registerCommand(
        BLUR_COMMAND,
        () => notifyFocus(false),
        COMMAND_PRIORITY_LOW
      )
    );
  });

  const subscribe =
    <Listener>(listeners: Set<Listener>) =>
    (listener: Listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };

  return {
    trackedCells() {
      const selection = $getSelection();
      if ($isTableSelection(selection)) {
        const anchorNode = $getNodeByKey(selection.anchor.key);
        const focusNode = $getNodeByKey(selection.focus.key);
        if (!anchorNode || !focusNode) return;
        return trackedFrom(cellOf(anchorNode), cellOf(focusNode));
      }
      if ($isRangeSelection(selection)) {
        const cell = cellOf($getNodeByKey(selection.anchor.key));
        return trackedFrom(cell, cell);
      }
      return;
    },
    registerSelection: subscribe(selectionListeners),
    registerFocus: subscribe(focusListeners),
    registerLayout: subscribe(layoutListeners),
    rootElement() {
      return editor()?.getRootElement() ?? null;
    },
    elementFor(key) {
      return editor()?.getElementByKey(key) ?? undefined;
    },
    cellElementFromTarget(target) {
      return getDOMCellFromTarget(target)?.elem;
    },
    shape(cells) {
      const fallback: TableMoveShape = { rows: 1, columns: 1 };
      const currentEditor = editor();
      if (!currentEditor) return fallback;
      return currentEditor.read(() => {
        const tracked = $trackedCellNodes(cells);
        if (!tracked) return fallback;
        const { anchorCell, focusCell } = tracked;
        const table = $getTableNodeFromLexicalNodeOrThrow(anchorCell);
        const [, aPos, fPos] = $computeTableMap(table, anchorCell, focusCell);
        const minRow = Math.min(aPos.startRow, fPos.startRow);
        const maxRow = Math.max(
          aPos.startRow + anchorCell.getRowSpan() - 1,
          fPos.startRow + focusCell.getRowSpan() - 1
        );
        const minColumn = Math.min(aPos.startColumn, fPos.startColumn);
        const maxColumn = Math.max(
          aPos.startColumn + anchorCell.getColSpan() - 1,
          fPos.startColumn + focusCell.getColSpan() - 1
        );
        return {
          rows: maxRow - minRow + 1,
          columns: maxColumn - minColumn + 1,
        };
      });
    },
    previewRect(cellElem, shape) {
      const cellRect = cellElem.getBoundingClientRect();
      const currentEditor = editor();
      if (!currentEditor) return cellRect;
      return currentEditor.read(() => {
        const targetCell = $getNearestNodeFromDOMNode(cellElem);
        if (!$isTableCellNode(targetCell) || !targetCell.isAttached()) {
          return cellRect;
        }
        const table = $getTableNodeFromLexicalNodeOrThrow(targetCell);
        const [map, targetPos] = $computeTableMap(
          table,
          targetCell,
          targetCell
        );
        const lastRow = map.length - 1;
        const lastColumn = (map[0]?.length ?? 1) - 1;

        const endColumn = Math.min(
          targetPos.startColumn + shape.columns - 1,
          lastColumn
        );
        const wantedEndRow = targetPos.startRow + shape.rows - 1;
        const endRow = Math.min(wantedEndRow, lastRow);

        const endCell = map[endRow]?.[endColumn]?.cell;
        const endElem = endCell
          ? currentEditor.getElementByKey(endCell.getKey())
          : null;
        const endRect = endElem?.getBoundingClientRect() ?? cellRect;

        const left = Math.min(cellRect.left, endRect.left);
        const top = Math.min(cellRect.top, endRect.top);
        const right = Math.max(cellRect.right, endRect.right);
        // Rows the move would append extend the preview past the table.
        const bottom =
          Math.max(cellRect.bottom, endRect.bottom) +
          (wantedEndRow - endRow) * cellRect.height;

        return { left, top, width: right - left, height: bottom - top };
      });
    },
    move(cells, targetElem) {
      const currentEditor = editor();
      if (!currentEditor) return false;
      let moved = false;
      currentEditor.update(() => {
        const targetCell = $getNearestNodeFromDOMNode(targetElem);
        if (!$isTableCellNode(targetCell) || !targetCell.isAttached()) return;
        const tracked = $trackedCellNodes(cells);
        if (!tracked) return;
        moved = true;
        $moveCellRange(
          currentEditor,
          tracked.anchorCell,
          tracked.focusCell,
          targetCell
        );
      });
      return moved;
    },
    selectCells(cells) {
      const currentEditor = editor();
      if (!currentEditor) return;
      currentEditor.update(() => {
        const tracked = $trackedCellNodes(cells);
        if (!tracked) return;
        const table = $getTableNodeFromLexicalNodeOrThrow(tracked.anchorCell);
        const tableSelection = $createTableSelection();
        tableSelection.set(
          table.getKey(),
          tracked.anchorCell.getKey(),
          tracked.focusCell.getKey()
        );
        $setSelection(tableSelection);
      });
      // The popup listens for this; programmatic $setSelection doesn't fire it.
      currentEditor.dispatchCommand(SELECTION_CHANGE_COMMAND, undefined);
    },
    menuAction(action, tracked) {
      editor()?.update(() => {
        // Prefer the live selection; re-anchor in the tracked cell if the tap
        // blurred the editor. The insert/delete helpers act on the selection.
        const selection = $getSelection();
        let cell =
          $isRangeSelection(selection) || $isTableSelection(selection)
            ? $getTableCellNodeFromLexicalNode(selection.anchor.getNode())
            : null;
        if (!cell) {
          const anchor = tracked?.anchor ? $getNodeByKey(tracked.anchor) : null;
          if ($isTableCellNode(anchor) && anchor.isAttached()) {
            anchor.selectStart();
            cell = anchor;
          }
        }
        if (cell) $runMenuAction(action, cell);
      });
    },
  };
}
