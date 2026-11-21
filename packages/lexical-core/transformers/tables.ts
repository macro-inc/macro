import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  CHECK_LIST,
  type ElementTransformer,
  type Transformer,
} from '@lexical/markdown';
import {
  $computeTableMapSkipCellCheck,
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
import {
  $isParagraphNode,
  $isTextNode,
  type ElementFormatType,
  type LexicalNode,
} from 'lexical';
import { match } from 'ts-pattern';
import {
  CUSTOM_TRANSFORMERS,
  STANDARD_TRANSFORMERS,
} from './customTransformers';
import { HTML_TEXT_FORMAT_TRANSFORMERS } from './htmlTextFormats';
import { I_IMAGE_CONSTRAINED, IMAGE } from './image';
import {
  E_BLOCK_EQUATION_NODE,
  E_INLINE_EQUATION_NODE,
  I_EQUATION_NODE,
} from './katex';
import {
  E_AGENT_SESSION_MENTION,
  E_BOOKING_LINK_MENTION,
  E_CONTACT_MENTION,
  E_DOCUMENT_MENTION,
  E_GROUP_MENTION,
  E_PR_MENTION,
  E_TAG_MENTION,
  E_USER_MENTION,
  I_AGENT_SESSION_MENTION,
  I_BOOKING_LINK_MENTION,
  I_CONNECT_APP,
  I_CONTACT_MENTION,
  I_DATE_MENTION,
  I_DOCUMENT_MENTION,
  I_GROUP_MENTION,
  I_PR_MENTION,
  I_TAG_MENTION,
  I_THEME_MENTION,
  I_USER_MENTION,
} from './mentions';
import {
  BR_TAG_TO_LINE_BREAK,
  codeFenceLines,
  HTML_ENTITY_TRANSFORMERS,
  LINK_XML,
} from './transformers';
import { UNKNOWN_MENTION } from './unknownMention';
import { I_VIDEO } from './video';

// Internal Table Node

const TAG_TABLE = 'm-table';
const TAG_TABLE_ROW = 'm-table-row';
const TAG_TABLE_CELL = 'm-table-cell';

// Like `xmlMatcher`, but tolerates optional `key="value"` attributes on the
// opening tag so attribute-less tags from older documents still match.
// Group 1 is the raw attribute string, group 2 the tag content.
function xmlMatcherWithAttrs(tag: string, flags?: string) {
  return new RegExp(
    `<${tag}((?:\\s+[\\w-]+="[^"]*")*)\\s*>(.*?)</${tag}>`,
    flags ?? 's'
  );
}

function serializeXmlAttrs(
  attrs: Record<string, string | number | undefined>
): string {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ` ${key}="${value}"`)
    .join('');
}

function parseXmlAttrs(raw: string | undefined): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of (raw ?? '').matchAll(/([\w-]+)="([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

// Attribute strings from parseXmlAttrs → validated numbers; invalid values
// become undefined so a bad attr falls back to the node's default.
function positiveAttr(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function spanAttr(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 2 ? value : undefined;
}

// Upstream's exact definition from @lexical/table's LexicalTableCellNode.ts;
// the package doesn't re-export the type from its root (not even on main).
type TableCellHeaderState =
  (typeof TableCellHeaderStates)[keyof typeof TableCellHeaderStates];

const HEADER_ATTR_BY_STATE: Record<number, string> = {
  [TableCellHeaderStates.ROW]: 'row',
  [TableCellHeaderStates.COLUMN]: 'col',
  [TableCellHeaderStates.BOTH]: 'both',
};

const HEADER_STATE_BY_ATTR: Record<string, TableCellHeaderState> = {
  row: TableCellHeaderStates.ROW,
  col: TableCellHeaderStates.COLUMN,
  both: TableCellHeaderStates.BOTH,
};

type CellAlignment = Exclude<ElementFormatType, ''>;

const CELL_ALIGNMENTS: readonly CellAlignment[] = [
  'left',
  'center',
  'right',
  'start',
  'end',
  'justify',
];

/** Reads an `align` attribute; anything but a cell alignment is none. */
function isCellAlignment(value: string | undefined): value is CellAlignment {
  return CELL_ALIGNMENTS.some((alignment) => alignment === value);
}

const REG_EXP_XML_TABLE = xmlMatcherWithAttrs(TAG_TABLE, '');
const REG_EXP_XML_TABLE_ROW = xmlMatcherWithAttrs(TAG_TABLE_ROW, 'gs');
const REG_EXP_XML_TABLE_CELL = xmlMatcherWithAttrs(TAG_TABLE_CELL, 'gs');

// Saves and reloads every inline chip and link a cell can hold, as the
// document-level internal set does.
const internalTransformersWithinTables: Transformer[] = [
  CHECK_LIST,
  LINK_XML,
  I_USER_MENTION,
  I_GROUP_MENTION,
  I_DOCUMENT_MENTION,
  I_PR_MENTION,
  I_BOOKING_LINK_MENTION,
  I_AGENT_SESSION_MENTION,
  I_CONTACT_MENTION,
  I_DATE_MENTION,
  I_THEME_MENTION,
  I_TAG_MENTION,
  I_CONNECT_APP,
  I_EQUATION_NODE,
  I_IMAGE_CONSTRAINED,
  IMAGE,
  I_VIDEO,
  ...HTML_TEXT_FORMAT_TRANSFORMERS,
  ...STANDARD_TRANSFORMERS,
  UNKNOWN_MENTION, // Last: the fallback for tags nothing above recognizes
];

// Transformers used inside table cells
const _TABLE_CELL_TRANSFORMERS: Transformer[] = [
  ...CUSTOM_TRANSFORMERS,
  I_EQUATION_NODE,
  I_USER_MENTION,
  I_DOCUMENT_MENTION,
  I_CONTACT_MENTION,
  I_DATE_MENTION,
];

// Transformers that export table cells to markdown
const _TABLE_CELL_EXPORT_TRANSFORMERS: Transformer[] = [
  ...CUSTOM_TRANSFORMERS,
  I_EQUATION_NODE,
  I_USER_MENTION,
  I_DOCUMENT_MENTION,
  I_CONTACT_MENTION,
  I_DATE_MENTION,
];

export const I_TABLE_NODE: ElementTransformer = {
  dependencies: [TableNode, TableRowNode, TableCellNode],
  type: 'element',
  regExp: REG_EXP_XML_TABLE,

  export: (node) => {
    if (!(node instanceof TableNode)) return null;

    const colWidths = node.getColWidths();
    let output = `<${TAG_TABLE}${serializeXmlAttrs({
      'col-widths': colWidths?.map((width) => Math.round(width)).join(','),
    })}>`;
    const rows = node.getChildren();

    for (const row of rows) {
      if (row instanceof TableRowNode) {
        output += `<${TAG_TABLE_ROW}${serializeXmlAttrs({
          height: row.getHeight(),
        })}>`;
        const cells = row.getChildren();

        for (const cell of cells) {
          if (cell instanceof TableCellNode) {
            output += `<${TAG_TABLE_CELL}${serializeXmlAttrs({
              colspan: cell.getColSpan() > 1 ? cell.getColSpan() : undefined,
              rowspan: cell.getRowSpan() > 1 ? cell.getRowSpan() : undefined,
              header: HEADER_ATTR_BY_STATE[cell.__headerState],
              align: cell.getFormatType() || undefined,
            })}>`;
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
      const tableAttrs = parseXmlAttrs(match[1]);
      const tableNode = new TableNode();
      const rowMatches = xmlContent.matchAll(REG_EXP_XML_TABLE_ROW);

      for (const rowMatch of rowMatches) {
        const rowAttrs = parseXmlAttrs(rowMatch[1]);
        const rowContent = rowMatch[2];
        const rowNode = new TableRowNode();

        const height = positiveAttr(rowAttrs.height);
        if (height) {
          rowNode.setHeight(height);
        }

        const cellMatches = rowContent.matchAll(REG_EXP_XML_TABLE_CELL);

        for (const cellMatch of cellMatches) {
          const cellAttrs = parseXmlAttrs(cellMatch[1]);
          const cellContent = cellMatch[2];
          const cellNode = new TableCellNode();

          const colSpan = spanAttr(cellAttrs.colspan);
          if (colSpan) {
            cellNode.setColSpan(colSpan);
          }
          const rowSpan = spanAttr(cellAttrs.rowspan);
          if (rowSpan) {
            cellNode.setRowSpan(rowSpan);
          }
          const headerState = HEADER_STATE_BY_ATTR[cellAttrs.header];
          if (headerState !== undefined) {
            cellNode.setHeaderStyles(headerState);
          }
          if (isCellAlignment(cellAttrs.align)) {
            cellNode.setFormat(cellAttrs.align);
          }

          $convertFromMarkdownString(
            cellContent.replace(/\\n/g, '\n').replaceAll('<br>', ''),
            internalTransformersWithinTables,
            cellNode
          );
          rowNode.append(cellNode);
        }

        tableNode.append(rowNode);
      }

      const colWidths = tableAttrs['col-widths']?.split(',').map(positiveAttr);
      if (
        colWidths?.length &&
        colWidths.every((width): width is number => width !== undefined)
      ) {
        tableNode.setColWidths(colWidths);
      }

      node.replace(tableNode);
    } catch (error) {
      console.error('Error parsing m-table:', error);
    }
  },
};

// External Table Node

const REG_EXP_TABLE_ROW = /^(?:\|)(.+)(?:\|)\s?$/;
// Each delimiter cell needs at least one dash, so an empty `| | |` row stays a row.
const REG_EXP_TABLE_ROW_DIVIDER = /^\|(?:\s*:?-+:?\s*\|)+\s*$/;

// Chips export in the order EXTERNAL_TRANSFORMERS gives them, so a cell writes
// each chip as a paragraph does.
const externalTransformersWithinTables: Transformer[] = [
  BR_TAG_TO_LINE_BREAK,
  CHECK_LIST,
  E_USER_MENTION,
  E_GROUP_MENTION,
  I_DOCUMENT_MENTION, // for citations
  E_DOCUMENT_MENTION,
  I_PR_MENTION,
  I_BOOKING_LINK_MENTION,
  I_AGENT_SESSION_MENTION,
  E_PR_MENTION,
  E_BOOKING_LINK_MENTION,
  E_AGENT_SESSION_MENTION,
  E_CONTACT_MENTION,
  I_DATE_MENTION,
  E_TAG_MENTION,
  I_CONNECT_APP,
  E_BLOCK_EQUATION_NODE,
  E_INLINE_EQUATION_NODE,
  IMAGE,
  I_VIDEO,
  ...HTML_ENTITY_TRANSFORMERS,
  ...HTML_TEXT_FORMAT_TRANSFORMERS,
  ...STANDARD_TRANSFORMERS,
  UNKNOWN_MENTION, // Last: the fallback for tags nothing above recognizes
];

// Cells import every inline chip a paragraph imports, since agents write them
// in cells too. These only import: a cell exports chips as a paragraph does.
const importTransformersWithinTables: Transformer[] = [
  LINK_XML,
  I_USER_MENTION,
  I_GROUP_MENTION,
  I_CONTACT_MENTION,
  I_PR_MENTION,
  I_BOOKING_LINK_MENTION,
  I_AGENT_SESSION_MENTION,
  I_TAG_MENTION,
  I_THEME_MENTION,
  I_CONNECT_APP,
  I_EQUATION_NODE,
  ...externalTransformersWithinTables,
  UNKNOWN_MENTION, // Last: the fallback for tags nothing above recognizes
];

function getTableColumnsSize(table: TableNode): number {
  const row = table.getFirstChild();
  return $isTableRowNode(row) ? row.getChildrenSize() : 0;
}

function createTableCell(cellContent: string): TableCellNode {
  const cellNode = new TableCellNode();
  // Export escapes cell newlines as `\n` so rows stay on one line; restore
  // them so multi-line content (lists, multiple blocks) survives the trip.
  $convertFromMarkdownString(
    cellContent.replace(/\\n/g, '\n').trim(),
    importTransformersWithinTables,
    cellNode,
    true
  );
  return cellNode;
}

// A complete inline `<m-…>{json}</m-…>` tag starting at `lastIndex`. Its body
// may hold pipes (`macro|` user ids) but no other tag, so an unclosed tag
// cannot swallow the cells after it.
const REG_EXP_XML_TAG_AT =
  /<(m-[\w-]+)(?:\s[^>]*)?>\{(?:(?!<\/?m-)[^\n])*?\}<\/\1>/y;

function matchAt(regExp: RegExp, text: string, index: number): string | null {
  regExp.lastIndex = index;
  return regExp.exec(text)?.[0] ?? null;
}

/**
 * Splits the inside of a pipe-table row into raw cell strings. As in GFM, a
 * pipe separates cells unless escaped (`\|`, unescaped here), code spans
 * included; it also stays inside a complete `<m-…>` tag.
 */
function splitTableRow(row: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let index = 0;
  while (index < row.length) {
    const char = row[index];
    if (char === '\\') {
      const next = row[index + 1] ?? '';
      cell += next === '|' ? '|' : char + next;
      index += 2;
      continue;
    }
    if (char === '|') {
      cells.push(cell);
      cell = '';
      index += 1;
      continue;
    }
    const tag = char === '<' ? matchAt(REG_EXP_XML_TAG_AT, row, index) : null;
    if (tag) {
      cell += tag;
      index += tag.length;
      continue;
    }
    cell += char;
    index += 1;
  }
  cells.push(cell);
  return cells;
}

/** Escapes unescaped pipes outside `<m-…>` tags so the cell stays one cell. */
function escapeCellPipes(markdown: string): string {
  let escaped = '';
  let index = 0;
  // A pipe after an odd run of backslashes is already escaped.
  let backslashRun = 0;
  while (index < markdown.length) {
    const char = markdown[index];
    const tag =
      char === '<' ? matchAt(REG_EXP_XML_TAG_AT, markdown, index) : null;
    if (tag) {
      escaped += tag;
      index += tag.length;
      backslashRun = 0;
      continue;
    }
    escaped += char === '|' && backslashRun % 2 === 0 ? '\\|' : char;
    backslashRun = char === '\\' ? backslashRun + 1 : 0;
    index += 1;
  }
  return escaped;
}

function mapToTableCells(textContent: string): Array<TableCellNode> | null {
  const match = textContent.match(REG_EXP_TABLE_ROW);
  if (!match || !match[1]) {
    return null;
  }

  return splitTableRow(match[1]).map((text) => createTableCell(text));
}

/** The alignment each `:---`, `:---:` or `---:` marker of a delimiter row sets. */
function columnAlignments(divider: string): Array<CellAlignment | ''> {
  return divider
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((marker) => {
      const trimmed = marker.trim();
      const left = trimmed.startsWith(':');
      const right = trimmed.endsWith(':');
      if (left && right) return 'center';
      if (right) return 'right';
      if (left) return 'left';
      return '';
    });
}

function delimiterFor(format: ElementFormatType): string {
  return match(format)
    .with('left', 'start', () => ':---')
    .with('center', () => ':---:')
    .with('right', 'end', () => '---:')
    .with('justify', '', () => '---')
    .exhaustive();
}

/** Aligns a cell unless it already has an alignment of its own. */
function $alignCell(cell: TableCellNode, alignment: ElementFormatType) {
  if (cell.getFormatType() === '') cell.setFormat(alignment);
}

/** Gives rows joining a table the alignment of their column's header cell. */
function $alignToHeader(table: TableNode, rows: TableRowNode[]) {
  const header = table.getFirstChild();
  if (!$isTableRowNode(header)) return;
  const headerCells = header.getChildren().filter($isTableCellNode);
  if (
    !headerCells.some((cell) => cell.hasHeaderState(TableCellHeaderStates.ROW))
  ) {
    return;
  }
  for (const row of rows) {
    row
      .getChildren()
      .filter($isTableCellNode)
      .forEach((cell, column) => {
        $alignCell(cell, headerCells[column]?.getFormatType() ?? '');
      });
  }
}

/**
 * Limits `E_TABLE_NODE` to GitHub tables: a header row, a delimiter row with
 * as many columns, then body rows, short ones padded with empty cells. `E_TABLE_NODE` alone reads any line between
 * pipes as a row, and appends rows to a table on the line above. So every other
 * run of pipe lines outside fenced code gets its leading pipe escaped and stays
 * text, and a table gets a blank line above it, so it never joins the block
 * before it. A run whose lines appear, in order, in one of `existingText` (the
 * markdown of paragraphs already in the document) is that paragraph's text,
 * not a new table, so it stays text too.
 */
export function isolatePipeTables(
  markdown: string,
  existingText: readonly string[] = []
): string {
  const lines = markdown.split('\n');
  const inCode = codeFenceLines(lines);
  const isRow = (index: number) =>
    index < lines.length &&
    !inCode[index] &&
    REG_EXP_TABLE_ROW.test(lines[index]);

  const output: string[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!isRow(index)) {
      output.push(lines[index]);
      index += 1;
      continue;
    }

    let end = index;
    while (isRow(end)) end += 1;
    const run = lines.slice(index, end);
    const header = run[0].match(REG_EXP_TABLE_ROW)?.[1] ?? '';
    const columns = splitTableRow(header).length;
    const runText = `\n${run.join('\n')}\n`;
    const isTable =
      run.length >= 2 &&
      REG_EXP_TABLE_ROW_DIVIDER.test(run[1]) &&
      columns === columnAlignments(run[1]).length &&
      !existingText.some((text) => `\n${text}\n`.includes(runText));

    if (isTable) {
      if (output.length > 0 && output[output.length - 1].trim() !== '') {
        output.push('');
      }
      // A short row gets empty cells, as in GFM; `E_TABLE_NODE` would start a
      // new table at a row of another width.
      output.push(
        ...run.map((line) => {
          const cells = splitTableRow(line.match(REG_EXP_TABLE_ROW)?.[1] ?? '');
          return `${line.trimEnd()}${' |'.repeat(Math.max(0, columns - cells.length))}`;
        })
      );
    } else {
      output.push(...run.map((line) => `\\${line}`));
    }
    index = end;
  }
  return output.join('\n');
}

export const E_TABLE_NODE: ElementTransformer = {
  dependencies: [TableNode, TableRowNode, TableCellNode],
  type: 'element',
  regExp: REG_EXP_TABLE_ROW,
  export: (node: LexicalNode) => {
    if (!$isTableNode(node)) {
      return null;
    }

    // Walk the computed grid rather than the row children so merged cells
    // (colspan/rowspan) pad the slots they cover and rows stay rectangular —
    // pipe tables cannot express merges.
    const [gridMap] = $computeTableMapSkipCellCheck(node, null, null);

    const output: string[] = [];
    for (let row = 0; row < gridMap.length; row++) {
      const rowOutput: string[] = [];

      for (let column = 0; column < gridMap[row].length; column++) {
        const mapCell = gridMap[row][column];
        if (!mapCell?.cell) {
          rowOutput.push('');
          continue;
        }

        if (mapCell.startRow === row && mapCell.startColumn === column) {
          const cellContent = $convertToMarkdownString(
            externalTransformersWithinTables,
            mapCell.cell
          )
            .replace(/\n/g, '\\n')
            .trim();
          rowOutput.push(escapeCellPipes(cellContent));
        } else {
          rowOutput.push('');
        }
      }

      output.push(`| ${rowOutput.join(' | ')} |`);
      // GFM reads the first row as the header, so the delimiter row follows it
      // and nothing else, carrying the header cells' alignment.
      if (row === 0) {
        const delimiters = gridMap[row].map((mapCell) =>
          delimiterFor(mapCell?.cell?.getFormatType() ?? '')
        );
        output.push(`| ${delimiters.join(' | ')} |`);
      }
    }
    return output.join('\n');
  },
  replace: (parentNode, _unused, match) => {
    // A delimiter right after a table's first row makes that row the header.
    // Anywhere else a delimiter-looking line imports as an ordinary row.
    const tableAbove = parentNode.getPreviousSibling();
    const headerRow = $isTableNode(tableAbove)
      ? tableAbove.getFirstChild()
      : null;
    if (
      REG_EXP_TABLE_ROW_DIVIDER.test(match[0]) &&
      $isTableNode(tableAbove) &&
      tableAbove.getChildrenSize() === 1 &&
      $isTableRowNode(headerRow)
    ) {
      const alignments = columnAlignments(match[0]);
      headerRow
        .getChildren()
        .filter($isTableCellNode)
        .forEach((cell, column) => {
          cell.setHeaderStyles(
            TableCellHeaderStates.ROW,
            TableCellHeaderStates.ROW
          );
          $alignCell(cell, alignments[column] ?? '');
        });
      tableAbove.selectEnd();
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
      const rows = table.getChildren().filter($isTableRowNode);
      previousSibling.append(...rows);
      $alignToHeader(previousSibling, rows);
      // Move the selection before removing the line it sits in.
      previousSibling.selectEnd();
      parentNode.remove();
      return;
    }

    parentNode.replace(table);
    table.selectEnd();
  },
};
