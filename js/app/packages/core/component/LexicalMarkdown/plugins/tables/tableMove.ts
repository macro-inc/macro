import {
  $generateJSONFromSelectedNodes,
  $generateNodesFromSerializedNodes,
} from '@lexical/clipboard';
import {
  $createTableSelection,
  $getTableNodeFromLexicalNodeOrThrow,
  $isTableCellNode,
  $isTableRowNode,
  type TableCellNode,
  type TableNode,
} from '@lexical/table';
import {
  $createParagraphNode,
  $getSelection,
  type LexicalEditor,
  type LexicalNode,
  SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
} from 'lexical';

/**
 * Moves the contents of the cell range spanned by `anchorCell`..`focusCell`
 * onto the grid anchored at `targetCell`: the range is snapshotted, the
 * source cells are emptied, and the snapshot is dispatched through the same
 * grid-insert command as pasting a copied range — so overflow clipping and
 * node-id reassignment behave identically to paste.
 *
 * Must be called inside an editor update. Returns true when a move happened.
 */
export function $moveCellRange(
  editor: LexicalEditor,
  anchorCell: TableCellNode,
  focusCell: TableCellNode,
  targetCell: TableCellNode
): boolean {
  const table = $getTableNodeFromLexicalNodeOrThrow(anchorCell);
  const sourceSelection = $createTableSelection();
  sourceSelection.set(table.getKey(), anchorCell.getKey(), focusCell.getKey());
  const sourceCells = sourceSelection.getNodes().filter($isTableCellNode);

  if (sourceCells.length === 0) return false;
  if (sourceCells.some((cell) => cell.is(targetCell))) return false;

  const serialized = $generateJSONFromSelectedNodes(
    editor,
    sourceSelection
  ).nodes;
  const nodes = $generateNodesFromSerializedNodes(serialized);

  for (const cell of sourceCells) {
    cell.clear();
    cell.append($createParagraphNode());
  }

  targetCell.selectStart();
  const dropSelection = $getSelection();
  if (!dropSelection) {
    $restoreSourceCells(sourceCells, nodes);
    return false;
  }

  const handled = editor.dispatchCommand(
    SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
    { nodes, selection: dropSelection }
  );
  if (!handled) {
    $restoreSourceCells(sourceCells, nodes);
    return false;
  }
  return true;
}

/**
 * Fallback if the grid-insert command went unhandled after the source cells
 * were already emptied: put the snapshotted content back.
 */
function $restoreSourceCells(
  sourceCells: TableCellNode[],
  nodes: LexicalNode[]
): void {
  const template = nodes[0] as TableNode | undefined;
  if (!template) return;
  const templateCells: TableCellNode[] = [];
  for (const row of template.getChildren()) {
    if (!$isTableRowNode(row)) continue;
    for (const cell of row.getChildren()) {
      if ($isTableCellNode(cell)) templateCells.push(cell);
    }
  }
  sourceCells.forEach((cell, index) => {
    const templateCell = templateCells[index];
    if (!templateCell) return;
    cell.clear();
    cell.append(...templateCell.getChildren());
  });
}
