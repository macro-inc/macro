import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  type TableNode,
} from '@lexical/table';
import {
  $createParagraphNode,
  $createTextNode,
  $isElementNode,
  type LexicalNode,
} from 'lexical';
import { climbWhile } from './tree';

/** A cell's content: plain text, or a node you build (for rich/formatted cells). */
export type CellContent = string | LexicalNode;

/**
 * The block-level child for a cell. A string (or stray inline node) is wrapped
 * in a paragraph; a block node you built (paragraph, list, …) is used as-is —
 * so you have full control over what a cell contains.
 */
function $cellChild(content: CellContent): LexicalNode {
  if (typeof content === 'string') {
    const p = $createParagraphNode();
    p.append($createTextNode(content));
    return p;
  }
  if ($isElementNode(content) && !content.isInline()) {
    return content;
  }
  const p = $createParagraphNode();
  p.append(content);
  return p;
}

/**
 * Build a TableNode from a 2D array of cells (one inner array per row). Each
 * cell is a string OR a node you construct — e.g. a paragraph with formatted
 * text, a list, etc. The first row is treated as a header row. Place it with
 * the normal node ops:
 *   $blockById(s, 'b7').insertAfter($table([['Fruit', 'Taste'], ['Apple', 'Sweet']]))
 *   $byId(s, 'oldTableId').replace($table(rows))   // rebuild an existing table
 */
export function $table(rows: CellContent[][]): TableNode {
  const table = $createTableNode();
  for (let ri = 0; ri < rows.length; ri++) {
    const row = $createTableRowNode();
    const isHeader = ri === 0;
    for (const content of rows[ri]) {
      const cell = $createTableCellNode(
        isHeader ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS
      );
      cell.append($cellChild(content));
      row.append(cell);
    }
    table.append(row);
  }
  return table;
}

/**
 * Set one cell's content, in place. `node` is the table (or any node inside it);
 * `row`/`col` are 0-based over the table's ACTUAL rows — the header is row 0,
 * and the `---` line in the rendering is not a row. `content` is a string or a
 * node you build.
 *   $setCell($byId(s, 'tableId'), 1, 0, 'Banana')
 */
export function $setCell(
  node: LexicalNode,
  row: number,
  col: number,
  content: CellContent
): void {
  const table = climbWhile(node, $isTableNode);
  if (!$isTableNode(table)) {
    throw new Error('$setCell: no enclosing table');
  }
  const cell = table
    .getChildren()
    .filter($isTableRowNode)
    [row]?.getChildren()
    .filter($isTableCellNode)[col];
  if (!cell) {
    throw new Error(`$setCell: no cell at [${row}, ${col}]`);
  }
  cell.clear();
  cell.append($cellChild(content));
}
