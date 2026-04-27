import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  CHECK_LIST,
  type ElementTransformer,
  TRANSFORMERS,
  type Transformer,
} from '@lexical/markdown';
import {
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from '@lexical/table';
import { $isParagraphNode, $isTextNode, type LexicalNode } from 'lexical';
import { CUSTOM_TRANSFORMERS } from './customTransformers';
import { E_BLOCK_EQUATION_NODE, I_EQUATION_NODE } from './katex';
import {
  E_CONTACT_MENTION,
  E_DOCUMENT_MENTION,
  E_USER_MENTION,
  I_CONTACT_MENTION,
  I_DOCUMENT_MENTION,
  I_USER_MENTION,
} from './mentions';
import {
  BR_TAG_TO_LINE_BREAK,
  HTML_ENTITY_TRANSFORMERS,
  xmlMatcher,
} from './transformers';

// Internal Table Node

const TAG_TABLE = 'm-table';
const TAG_TABLE_ROW = 'm-table-row';
const TAG_TABLE_CELL = 'm-table-cell';

const REG_EXP_XML_TABLE = xmlMatcher(TAG_TABLE, '');
const REG_EXP_XML_TABLE_ROW = xmlMatcher(TAG_TABLE_ROW, 'gs');
const REG_EXP_XML_TABLE_CELL = xmlMatcher(TAG_TABLE_CELL, 'gs');

const internalTransformersWithinTables: Transformer[] = [
  CHECK_LIST,
  I_USER_MENTION,
  I_DOCUMENT_MENTION,
  I_CONTACT_MENTION,
  I_EQUATION_NODE,
  ...TRANSFORMERS,
];

// Transformers used inside table cells
const _TABLE_CELL_TRANSFORMERS: Transformer[] = [
  ...CUSTOM_TRANSFORMERS,
  I_EQUATION_NODE,
  I_USER_MENTION,
  I_DOCUMENT_MENTION,
  I_CONTACT_MENTION,
];

// Transformers that export table cells to markdown
const _TABLE_CELL_EXPORT_TRANSFORMERS: Transformer[] = [
  ...CUSTOM_TRANSFORMERS,
  I_EQUATION_NODE,
  I_USER_MENTION,
  I_DOCUMENT_MENTION,
  I_CONTACT_MENTION,
];

export const I_TABLE_NODE: ElementTransformer = {
  dependencies: [TableNode, TableRowNode, TableCellNode],
  type: 'element',
  regExp: REG_EXP_XML_TABLE,

  export: (node) => {
    if (!(node instanceof TableNode)) return null;

    let output = `<${TAG_TABLE}>`;
    const rows = node.getChildren();

    for (const row of rows) {
      if (row instanceof TableRowNode) {
        output += `<${TAG_TABLE_ROW}>`;
        const cells = row.getChildren();

        for (const cell of cells) {
          if (cell instanceof TableCellNode) {
            output += `<${TAG_TABLE_CELL}>`;
            output += $convertToMarkdownString(
              internalTransformersWithinTables,
              cell
            ).replace(/\n/g, '\\n');
            output += `</${TAG_TABLE_CELL}>`;
          }
        }

        output += `</${TAG_TABLE_ROW}>`;
      }
    }

    output += `</${TAG_TABLE}>`;
    return output;
  },

  replace: (node, _children, match, _isImport) => {
    try {
      const xmlContent = match[0];
      const tableNode = new TableNode();
      const rowMatches = xmlContent.matchAll(REG_EXP_XML_TABLE_ROW);

      for (const rowMatch of rowMatches) {
        const rowContent = rowMatch[1];
        const rowNode = new TableRowNode();
        const cellMatches = rowContent.matchAll(REG_EXP_XML_TABLE_CELL);

        for (const cellMatch of cellMatches) {
          const cellContent = cellMatch[1];
          const cellNode = new TableCellNode();
          $convertFromMarkdownString(
            cellContent.replace(/\\n/g, '\n').replaceAll('<br>', ''),
            internalTransformersWithinTables,
            cellNode
          );
          rowNode.append(cellNode);
        }

        tableNode.append(rowNode);
      }

      node.replace(tableNode);
    } catch (error) {
      console.error('Error parsing m-table:', error);
    }
  },
};

// External Table Node

const REG_EXP_TABLE_ROW = /^(?:\|)(.+)(?:\|)\s?$/;
const REG_EXP_TABLE_ROW_DIVIDER = /^(\| ?:?-*:? ?)+\|\s?$/;

const externalTransformersWithinTables: Transformer[] = [
  BR_TAG_TO_LINE_BREAK,
  CHECK_LIST,
  E_USER_MENTION,
  I_DOCUMENT_MENTION, // for citations
  E_DOCUMENT_MENTION,
  E_CONTACT_MENTION,
  E_BLOCK_EQUATION_NODE,
  ...HTML_ENTITY_TRANSFORMERS,
  ...TRANSFORMERS,
];

function getTableColumnsSize(table: TableNode): number {
  const row = table.getFirstChild();
  return $isTableRowNode(row) ? row.getChildrenSize() : 0;
}

function createTableCell(cellContent: string): TableCellNode {
  const cellNode = new TableCellNode();
  $convertFromMarkdownString(
    cellContent,
    externalTransformersWithinTables,
    cellNode,
    true
  );
  return cellNode;
}

function mapToTableCells(textContent: string): Array<TableCellNode> | null {
  const match = textContent.match(REG_EXP_TABLE_ROW);
  if (!match || !match[1]) {
    return null;
  }

  return match[1].split('|').map((text) => createTableCell(text));
}

export const E_TABLE_NODE: ElementTransformer = {
  dependencies: [TableNode, TableRowNode, TableCellNode],
  type: 'element',
  regExp: REG_EXP_TABLE_ROW,
  export: (node: LexicalNode) => {
    if (!$isTableNode(node)) {
      return null;
    }

    const output: string[] = [];
    for (const row of node.getChildren()) {
      if (!$isTableRowNode(row)) {
        continue;
      }

      const rowOutput = [];
      let isHeaderRow = false;
      for (const cell of row.getChildren()) {
        if ($isTableCellNode(cell)) {
          const cellContent = $convertToMarkdownString(
            externalTransformersWithinTables,
            cell
          )
            .replace(/\n/g, '\\n')
            .trim();

          rowOutput.push(cellContent);
          if (cell.__headerState === TableCellHeaderStates.ROW) {
            isHeaderRow = true;
          }
        }
      }

      output.push(`| ${rowOutput.join(' | ')} |`);
      if (isHeaderRow) {
        output.push(`| ${rowOutput.map(() => '---').join(' | ')} |`);
      }
    }
    return output.join('\n');
  },
  replace: (parentNode, _unused, match) => {
    if (REG_EXP_TABLE_ROW_DIVIDER.test(match[0])) {
      const table = parentNode.getPreviousSibling();
      if (!table || !$isTableNode(table)) {
        return;
      }

      const rows = table.getChildren();
      const lastRow = rows[rows.length - 1];
      if (!lastRow || !$isTableRowNode(lastRow)) {
        return;
      }

      for (const cell of lastRow.getChildren()) {
        if (!$isTableCellNode(cell)) {
          continue;
        }
        cell.setHeaderStyles(
          TableCellHeaderStates.NO_STATUS,
          TableCellHeaderStates.NO_STATUS
          // TableCellHeaderStates.ROW, // disable header for now
          // TableCellHeaderStates.ROW // disable header for now
        );
      }

      parentNode.remove();
      return;
    }

    const matchCells = mapToTableCells(match[0]);
    if (matchCells == null) {
      return;
    }

    const rows = [matchCells];
    let sibling = parentNode.getPreviousSibling();
    let maxCells = matchCells.length;

    while (sibling) {
      if (!$isParagraphNode(sibling)) {
        break;
      }
      if (sibling.getChildrenSize() !== 1) {
        break;
      }

      const firstChild = sibling.getFirstChild();
      if (!$isTextNode(firstChild)) {
        break;
      }

      const cells = mapToTableCells(firstChild.getTextContent());
      if (cells == null) {
        break;
      }

      maxCells = Math.max(maxCells, cells.length);
      rows.unshift(cells);

      const previousSibling = sibling.getPreviousSibling();
      sibling.remove();
      sibling = previousSibling;
    }

    const table = $createTableNode();
    for (const cells of rows) {
      const tableRow = $createTableRowNode();
      table.append(tableRow);

      for (let i = 0; i < maxCells; i++) {
        tableRow.append(i < cells.length ? cells[i] : createTableCell(''));
      }
    }

    const previousSibling = parentNode.getPreviousSibling();
    if (
      $isTableNode(previousSibling) &&
      getTableColumnsSize(previousSibling) === maxCells
    ) {
      previousSibling.append(...table.getChildren());
      parentNode.remove();
    } else {
      parentNode.replace(table);
    }

    table.selectEnd();
  },
};
