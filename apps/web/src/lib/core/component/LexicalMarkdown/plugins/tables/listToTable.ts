/**
 * @file Converts a nested list into a table: each top-level item becomes a
 * column header and its nested items become that column's cells, so
 *
 *   - column 1        | column 1 | column 2 |
 *     - goes in row 1 |----------|----------|
 *     - goes in row 2 | row 1    | row 1    |
 *   - column 2    →   | row 2    | row 2    |
 *     - goes in row 1 |          |          |
 *     - goes in row 2 |          |          |
 *
 * Content nested deeper than two levels stays a list inside its cell.
 */
import {
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListItemNode,
  type ListNode,
  type ListType,
} from '@lexical/list';
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  TableCellHeaderStates,
  type TableCellNode,
  type TableNode,
} from '@lexical/table';
import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootNode,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type LexicalCommand,
  type LexicalEditor,
  type NodeKey,
} from 'lexical';
import { $collectNestedGroup } from '../draggable-block/draggableBlockPlugin';

/** Converts the ListNode with the given key into a table. */
export const LIST_TO_TABLE_COMMAND: LexicalCommand<NodeKey> = createCommand(
  'LIST_TO_TABLE_COMMAND'
);

export type ListGridCell = {
  /** Item whose inline content becomes the cell's paragraph. */
  item: ListItemNode;
  /** Nested lists holding deeper content; moved into the cell as-is. */
  nestedLists: ListNode[];
  /** Deeper flat-indent items; moved into a new list inside the cell. */
  deepItems: ListItemNode[];
};

export type ListGridColumn = {
  header: ListItemNode;
  cells: ListGridCell[];
};

/** A list item whose only children are lists — the tree-nesting wrapper shape. */
function isNestingWrapper(item: ListItemNode): boolean {
  const children = item.getChildren();
  return children.length > 0 && children.every((child) => $isListNode(child));
}

function $newCell(item: ListItemNode): ListGridCell {
  return {
    item,
    // Lists embedded directly in the item are deeper content for its cell.
    nestedLists: item.getChildren().filter($isListNode),
    deepItems: [],
  };
}

/** Items of a nested list become cells; anything deeper stays with its cell. */
function $subListToCells(sub: ListNode, cells: ListGridCell[]): void {
  let cellIndent: number | null = null;
  for (const node of sub.getChildren()) {
    if (!$isListItemNode(node)) continue;
    if (isNestingWrapper(node)) {
      const lists = node.getChildren().filter($isListNode);
      const last = cells[cells.length - 1];
      if (last) last.nestedLists.push(...lists);
      else for (const list of lists) $subListToCells(list, cells);
      continue;
    }
    cellIndent ??= node.getIndent();
    if (node.getIndent() > cellIndent && cells.length > 0) {
      cells[cells.length - 1].deepItems.push(node);
      continue;
    }
    cells.push($newCell(node));
  }
}

/** Turns a header item plus its nested group (see $collectNestedGroup) into cells. */
function $groupToCells(group: ListItemNode[]): ListGridCell[] {
  const [header, ...rest] = group;
  const cells: ListGridCell[] = [];
  for (const child of header.getChildren()) {
    if ($isListNode(child)) $subListToCells(child, cells);
  }
  let cellIndent: number | null = null;
  for (const item of rest) {
    if (isNestingWrapper(item)) {
      for (const sub of item.getChildren()) {
        if ($isListNode(sub)) $subListToCells(sub, cells);
      }
      continue;
    }
    cellIndent ??= item.getIndent();
    if (item.getIndent() > cellIndent && cells.length > 0) {
      cells[cells.length - 1].deepItems.push(item);
    } else {
      cells.push($newCell(item));
    }
  }
  return cells;
}

/**
 * Reads a list as a table grid. Returns null when the list doesn't have a
 * table shape: fewer than two top-level items, or a top-level item without
 * nested content. Does not mutate — safe in a read context.
 */
export function $listToGrid(list: ListNode): ListGridColumn[] | null {
  if (list.getListType() === 'check') return null;
  const children = list.getChildren();
  const columns: ListGridColumn[] = [];
  let i = 0;
  while (i < children.length) {
    const item = children[i];
    if (!$isListItemNode(item) || isNestingWrapper(item)) return null;
    const group = $collectNestedGroup(item);
    const cells = $groupToCells(group);
    if (cells.length === 0) return null;
    columns.push({ header: item, cells });
    i += group.length;
  }
  return columns.length >= 2 ? columns : null;
}

/**
 * Whether LIST_TO_TABLE_COMMAND would convert this list. Requires a top-level
 * list (tables aren't allowed inside table cells or other lists) with a table
 * shape.
 */
export function $canConvertListToTable(list: ListNode): boolean {
  return $isRootNode(list.getParent()) && $listToGrid(list) !== null;
}

/**
 * The convertible list containing the current selection, if any. Must be
 * called within a Lexical read/update context.
 */
export function $getConvertibleListFromSelection(): ListNode | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const list = selection.anchor.getNode().getTopLevelElement();
  return $isListNode(list) && $canConvertListToTable(list) ? list : null;
}

/** Moves a cell's source content out of the list into a fresh table cell. */
function $fillCell(
  cell: TableCellNode,
  source: ListGridCell,
  listType: ListType
): TableCellNode {
  const paragraph = $createParagraphNode();
  for (const child of source.item.getChildren()) {
    if (!$isListNode(child)) paragraph.append(child);
  }
  cell.append(paragraph);
  for (const nested of source.nestedLists) cell.append(nested);
  if (source.deepItems.length > 0) {
    const list = $createListNode(listType);
    list.append(...source.deepItems);
    cell.append(list);
  }
  return cell;
}

/**
 * Builds a table from the grid, moving the list's content into it. Ragged
 * columns are padded with empty cells. The caller replaces the (now gutted)
 * list with the returned table.
 */
export function $gridToTable(
  columns: ListGridColumn[],
  listType: ListType
): TableNode {
  const table = $createTableNode();

  const headerRow = $createTableRowNode();
  for (const column of columns) {
    headerRow.append(
      $fillCell(
        $createTableCellNode(TableCellHeaderStates.ROW),
        { item: column.header, nestedLists: [], deepItems: [] },
        listType
      )
    );
  }
  table.append(headerRow);

  const rowCount = Math.max(...columns.map((column) => column.cells.length));
  for (let r = 0; r < rowCount; r++) {
    const row = $createTableRowNode();
    for (const column of columns) {
      const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
      const source = column.cells[r];
      if (source) $fillCell(cell, source, listType);
      else cell.append($createParagraphNode());
      row.append(cell);
    }
    table.append(row);
  }
  return table;
}

function $selectTableStart(table: TableNode): void {
  const row = table.getFirstChild();
  const cell = $isElementNode(row) ? row.getFirstChild() : null;
  const paragraph = $isElementNode(cell) ? cell.getFirstChild() : null;
  if ($isElementNode(paragraph)) paragraph.selectEnd();
}

export function registerListToTableCommand(editor: LexicalEditor): () => void {
  return editor.registerCommand(
    LIST_TO_TABLE_COMMAND,
    (listKey) => {
      const list = $getNodeByKey(listKey);
      if (!$isListNode(list) || !$isRootNode(list.getParent())) return false;
      const columns = $listToGrid(list);
      if (!columns) return false;
      const table = $gridToTable(columns, list.getListType());
      list.replace(table);
      $selectTableStart(table);
      return true;
    },
    COMMAND_PRIORITY_EDITOR
  );
}
