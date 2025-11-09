/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mdStore } from '@block-md/signal/markdownBlockData';
import { createBlockSignal } from '@core/block';
import {
  DropdownMenuContent,
  MenuItem,
  MenuSeparator,
} from '@core/component/Menu';
import { Tooltip } from '@core/component/Tooltip';
import ArrowLineDown from '@icon/regular/arrow-line-down.svg';
import ArrowLineLeft from '@icon/regular/arrow-line-left.svg';
import ArrowLineRight from '@icon/regular/arrow-line-right.svg';
import ArrowLineUp from '@icon/regular/arrow-line-up.svg';
import ArrowsIn from '@icon/regular/arrows-in-line-horizontal.svg';
import ArrowsOut from '@icon/regular/arrows-out-line-horizontal.svg';
import CaretDown from '@icon/regular/caret-down.svg';
import TrashCan from '@icon/regular/trash-simple.svg';
import X from '@icon/regular/x.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import {
  $computeTableMapSkipCellCheck,
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $getNodeTriplet,
  $getTableNodeFromLexicalNodeOrThrow,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  $isTableSelection,
  $unmergeCell,
  getTableElement,
  getTableObserverFromTableElement,
  type TableCellNode,
  type TableSelection,
} from '@lexical/table';
import { createCallback } from '@solid-primitives/rootless';
import type { ElementNode, LexicalEditor } from 'lexical';
import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
} from 'lexical';
import { type JSX, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { nodeByKey } from '../../utils';

// Helper Functions
function computeSelectionCount(selection: TableSelection): {
  columns: number;
  rows: number;
} {
  const selectionShape = selection.getShape();
  return {
    columns: selectionShape.toX - selectionShape.fromX + 1,
    rows: selectionShape.toY - selectionShape.fromY + 1,
  };
}

function $canUnmerge(): boolean {
  const selection = $getSelection();

  if (
    ($isRangeSelection(selection) && !selection.isCollapsed()) ||
    ($isTableSelection(selection) && !selection.anchor.is(selection.focus)) ||
    (!$isRangeSelection(selection) && !$isTableSelection(selection))
  ) {
    return false;
  }

  const [cell] = $getNodeTriplet(selection.anchor);
  return cell.__colSpan > 1 || cell.__rowSpan > 1;
}

function $cellContainsEmptyParagraph(cell: TableCellNode): boolean {
  if (cell.getChildrenSize() !== 1) {
    return false;
  }

  const firstChild = cell.getFirstChildOrThrow();
  return $isParagraphNode(firstChild) && firstChild.isEmpty();
}

function $selectLastDescendant(node: ElementNode): void {
  const lastDescendant = node.getLastDescendant();

  if ($isTextNode(lastDescendant)) {
    lastDescendant.select();
  } else if ($isElementNode(lastDescendant)) {
    lastDescendant.selectEnd();
  } else if (lastDescendant !== null) {
    lastDescendant.selectNext();
  }
}

function currentCellBackgroundColor(editor: LexicalEditor): null | string {
  return editor.read(() => {
    const selection = $getSelection();

    if ($isRangeSelection(selection) || $isTableSelection(selection)) {
      const [cell] = $getNodeTriplet(selection.anchor);
      if ($isTableCellNode(cell)) {
        return cell.getBackgroundColor();
      }
    }

    return null;
  });
}

// Signal Definitions
export const menuButtonRefSignal = createBlockSignal<
  HTMLDivElement | undefined
>(undefined);
export const anchorElemRefSignal = createBlockSignal<HTMLElement | undefined>(
  undefined
);
export const tableCellNodeKeySignal = createBlockSignal<string | undefined>(
  undefined
);

// Component Types
type ActionMenuProps = Readonly<{
  tableCellNodeKey: string;
  cellMerge: boolean;
}>;

// Component Definitions
function ActionMenu({
  tableCellNodeKey: initialTableCellNodeKey,
  cellMerge,
}: ActionMenuProps) {
  const mdData = mdStore.get;
  const editor = () => mdData.editor;

  const [tableCellNodeKey, setTableCellNodeKey] = createBlockSignal<string>(
    initialTableCellNodeKey
  );
  const [selectionCounts, setSelectionCounts] = createBlockSignal<{
    rows: number;
    columns: number;
  }>({
    columns: 1,
    rows: 1,
  });

  const initialBackgroundColor = () => {
    const _editor = editor();
    return !_editor ? '' : currentCellBackgroundColor(_editor) || '';
  };

  const [_backgroundColor, _setBackgroundColor] = createBlockSignal<string>(
    initialBackgroundColor()
  );

  // State Helpers
  const canMergeCells = () => {
    return editor()?.read(() => {
      const selection = $getSelection();
      if ($isTableSelection(selection)) {
        const currentSelectionCounts = computeSelectionCount(selection);
        setSelectionCounts(currentSelectionCounts);
        return (
          currentSelectionCounts.columns > 1 || currentSelectionCounts.rows > 1
        );
      }
      return false;
    });
  };

  const canUnmergeCell = () => {
    return editor()?.read(() => $canUnmerge());
  };

  // Action Functions
  const clearTableSelection = createCallback(() => {
    const _editor = editor();
    if (!_editor) return;

    const _tableCellNode = nodeByKey(_editor, tableCellNodeKey());
    if (!_tableCellNode || !$isTableCellNode(_tableCellNode)) return;

    _editor.update(() => {
      if (_tableCellNode.isAttached()) {
        const tableNode = $getTableNodeFromLexicalNodeOrThrow(_tableCellNode);
        const tableElement = getTableElement(
          tableNode,
          _editor.getElementByKey(tableNode.getKey())
        );

        if (!tableElement) return;

        const tableObserver = getTableObserverFromTableElement(tableElement);
        if (tableObserver !== null) {
          tableObserver.$clearHighlight();
        }

        tableNode.markDirty();
        setTableCellNodeKey(_tableCellNode.getLatest().getKey());
      }

      $setSelection(null);
    });
  });

  const mergeTableCellsAtSelection = () => {
    editor()?.update(() => {
      const selection = $getSelection();

      if ($isTableSelection(selection)) {
        const nodes = selection.getNodes();
        const tableCells = nodes.filter($isTableCellNode);
        if (tableCells.length === 0) return;

        const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCells[0]);
        const [gridMap] = $computeTableMapSkipCellCheck(tableNode, null, null);

        let minRow = Infinity;
        let maxRow = -Infinity;
        let minCol = Infinity;
        let maxCol = -Infinity;
        const processedCells = new Set();

        for (const row of gridMap) {
          for (const mapCell of row) {
            if (!mapCell || !mapCell.cell) continue;

            const cellKey = mapCell.cell.getKey();
            if (processedCells.has(cellKey)) continue;

            if (tableCells.some((cell) => cell.is(mapCell.cell))) {
              processedCells.add(cellKey);

              const cellStartRow = mapCell.startRow;
              const cellStartCol = mapCell.startColumn;
              const cellRowSpan = mapCell.cell.__rowSpan || 1;
              const cellColSpan = mapCell.cell.__colSpan || 1;

              minRow = Math.min(minRow, cellStartRow);
              maxRow = Math.max(maxRow, cellStartRow + cellRowSpan - 1);
              minCol = Math.min(minCol, cellStartCol);
              maxCol = Math.max(maxCol, cellStartCol + cellColSpan - 1);
            }
          }
        }

        if (minRow === Infinity || minCol === Infinity) return;

        const totalRowSpan = maxRow - minRow + 1;
        const totalColSpan = maxCol - minCol + 1;
        const targetCellMap = gridMap[minRow][minCol];

        if (!targetCellMap?.cell) return;

        const targetCell = targetCellMap.cell;
        targetCell.setColSpan(totalColSpan);
        targetCell.setRowSpan(totalRowSpan);

        const seenCells = new Set([targetCell.getKey()]);

        for (let row = minRow; row <= maxRow; row++) {
          for (let col = minCol; col <= maxCol; col++) {
            const mapCell = gridMap[row][col];
            if (!mapCell?.cell) continue;

            const currentCell = mapCell.cell;
            const key = currentCell.getKey();

            if (!seenCells.has(key)) {
              seenCells.add(key);
              const isEmpty = $cellContainsEmptyParagraph(currentCell);

              if (!isEmpty) {
                targetCell.append(...currentCell.getChildren());
              }

              currentCell.remove();
            }
          }
        }

        if (targetCell.getChildrenSize() === 0) {
          targetCell.append($createParagraphNode());
        }

        $selectLastDescendant(targetCell);
      }
    });
  };

  const unmergeTableCellsAtSelection = () => {
    editor()?.update(() => {
      $unmergeCell();
    });
  };

  const insertTableRowAtSelection = createCallback(
    (shouldInsertAfter: boolean) => {
      editor()?.update(() => {
        for (let i = 0; i < selectionCounts().rows; i++) {
          $insertTableRowAtSelection(shouldInsertAfter);
        }
      });
    }
  );

  const insertTableColumnAtSelection = createCallback(
    (shouldInsertAfter: boolean) => {
      editor()?.update(() => {
        for (let i = 0; i < selectionCounts().columns; i++) {
          $insertTableColumnAtSelection(shouldInsertAfter);
        }
      });
    }
  );

  const deleteTableRowAtSelection = createCallback(() => {
    editor()?.update(() => {
      $deleteTableRowAtSelection();
    });
  });

  const deleteTableAtSelection = createCallback(() => {
    const _editor = editor();
    if (!_editor) return;

    const _tableCellNode = nodeByKey(_editor, tableCellNodeKey());
    if (!_tableCellNode) return;

    _editor.update(() => {
      const tableNode = $getTableNodeFromLexicalNodeOrThrow(_tableCellNode);
      tableNode.remove();
      clearTableSelection();
    });
  });

  const deleteTableColumnAtSelection = createCallback(() => {
    editor()?.update(() => {
      $deleteTableColumnAtSelection();
    });
  });

  // Component Render
  return (
    <DropdownMenu placement="right-start">
      <DropdownMenu.Trigger class="dropdown-menu__trigger">
        <Tooltip tooltip="Table Options">
          <div class="size-6 rounded-md p-0 bg-button hover:bg-hover hover-transition-bg flex items-center justify-center">
            <CaretDown class="size-4" />
          </div>
        </Tooltip>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenuContent class="dropdown-menu__content w-44">
          <Show when={cellMerge}>
            <Show when={canMergeCells()}>
              <MenuItem
                text="Merge cells"
                onClick={() => mergeTableCellsAtSelection()}
                icon={ArrowsIn}
              />
              <MenuSeparator />
            </Show>
            <Show when={canUnmergeCell()}>
              <MenuItem
                text="Unmerge cells"
                onClick={() => unmergeTableCellsAtSelection()}
                icon={ArrowsOut}
              />
              <MenuSeparator />
            </Show>
          </Show>

          <MenuItem
            text={`Insert ${selectionCounts().rows === 1 ? 'row' : `${selectionCounts().rows} rows`} above`}
            onClick={() => insertTableRowAtSelection(false)}
            icon={ArrowLineUp}
          />

          <MenuItem
            text={`Insert ${selectionCounts().rows === 1 ? 'row' : `${selectionCounts().rows} rows`} below`}
            onClick={() => insertTableRowAtSelection(true)}
            icon={ArrowLineDown}
          />
          <MenuSeparator />

          <MenuItem
            text={`Insert ${selectionCounts().columns === 1 ? 'column' : `${selectionCounts().columns} columns`} left`}
            onClick={() => insertTableColumnAtSelection(false)}
            icon={ArrowLineLeft}
          />

          <MenuItem
            text={`Insert ${selectionCounts().columns === 1 ? 'column' : `${selectionCounts().columns} columns`} right`}
            onClick={() => insertTableColumnAtSelection(true)}
            icon={ArrowLineRight}
          />
          <MenuSeparator />

          <MenuItem
            text="Delete column"
            onClick={() => deleteTableColumnAtSelection()}
            icon={X}
          />

          <MenuItem
            text="Delete row"
            onClick={() => deleteTableRowAtSelection()}
            icon={X}
          />

          <MenuItem
            text="Delete table"
            onClick={() => deleteTableAtSelection()}
            icon={() => <TrashCan class="text-failure size-4" />}
          />
        </DropdownMenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}

function ActionMenuContainer({
  cellMerge,
}: {
  cellMerge: boolean;
}): JSX.Element {
  const tableCellNodeKey = tableCellNodeKeySignal.get;

  return (
    <div
      ref={menuButtonRefSignal.set}
      class="table-cell-action-button-container--inactive"
    >
      <Show when={tableCellNodeKey()}>
        <div class="size-4 rounded-md p-0">
          <ActionMenu
            tableCellNodeKey={tableCellNodeKey()!}
            cellMerge={cellMerge}
          />
        </div>
      </Show>
    </div>
  );
}

export default function TableActionMenu({
  anchorElem = document.body,
  cellMerge = false,
}: {
  anchorElem?: HTMLElement;
  cellMerge?: boolean;
}) {
  anchorElemRefSignal.set(anchorElem);

  return (
    <Portal mount={anchorElem}>
      <ActionMenuContainer cellMerge={cellMerge} />
    </Portal>
  );
}
