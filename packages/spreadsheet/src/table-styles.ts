import { type SheetTable, tableAt, tableBounds } from './sheet-tables';
import {
  formatCellAddress,
  type SpreadsheetCellEdits,
  type SpreadsheetCells,
} from './spreadsheet-document';

/** The Office theme's accent colors, which Excel's table styles use. */
const ACCENTS = [
  '#4472C4',
  '#ED7D31',
  '#A5A5A5',
  '#FFC000',
  '#5B9BD5',
  '#70AD47',
];

/**
 * An Excel table style's color and whether its header is filled. Each style
 * family repeats gray and the six accents, so TableStyleMedium2 (Excel's
 * default) is the first accent. A custom style draws as the default.
 */
function styleAccent(style: string) {
  const match = /^TableStyle(Light|Medium|Dark)(\d+)$/.exec(style);
  if (!match) return { color: ACCENTS[0], filledHeader: true };
  const offset = (Number(match[2]) - 1) % 7;
  return {
    color: offset ? ACCENTS[offset - 1] : '#7F7F7F',
    filledHeader: match[1] !== 'Light',
  };
}

/** Header colors a table can take, with the Excel style export writes. A
 * color Excel's styles lack is kept as the table's own color. */
export const TABLE_COLORS = [
  { label: 'Gray', color: '#5f6368', style: 'TableStyleMedium1' },
  { label: 'Blue', color: '#4472c4', style: 'TableStyleMedium2' },
  { label: 'Light blue', color: '#5b9bd5', style: 'TableStyleMedium6' },
  { label: 'Teal', color: '#00897b', style: 'TableStyleMedium7' },
  { label: 'Green', color: '#70ad47', style: 'TableStyleMedium7' },
  { label: 'Gold', color: '#ffc000', style: 'TableStyleMedium5' },
  { label: 'Orange', color: '#ed7d31', style: 'TableStyleMedium3' },
  { label: 'Red', color: '#d93025', style: 'TableStyleMedium3' },
  { label: 'Pink', color: '#d01884', style: 'TableStyleMedium3' },
  { label: 'Purple', color: '#8e24aa', style: 'TableStyleMedium2' },
] as const;

/** A table's color: its own, or its style's. */
export function tableColor(table: SheetTable): string {
  return (
    table.color ?? styleAccent(table.style ?? 'TableStyleMedium2').color
  ).toLowerCase();
}

/** The table with `color` as its header color. */
export function coloredTable(table: SheetTable, color: string): SheetTable {
  const choice =
    TABLE_COLORS.find((item) => item.color === color.toLowerCase()) ??
    TABLE_COLORS[1];
  const { color: _color, ...rest } = table;
  const styled = { ...rest, style: choice.style };
  return styleAccent(choice.style).color.toLowerCase() === choice.color
    ? styled
    : { ...styled, color: choice.color };
}

/** How a table draws one of its cells, under the cell's own formatting. */
export type TableCellLook = {
  background?: string;
  color?: string;
  bold?: boolean;
  borderTop?: string;
  borderBottom?: string;
  /** The table whose header row holds the cell. */
  header?: SheetTable;
  /** Banded rows and columns: the table color a stripe tints with. */
  stripe?: string;
};

export function tableCellLook(
  tables: SheetTable[] | undefined,
  row: number,
  column: number
): TableCellLook | undefined {
  const table = tableAt(tables, row, column);
  if (!table) return;
  const bounds = tableBounds(table);
  if (!table.style) return row === bounds.top ? { header: table } : {};
  const { filledHeader } = styleAccent(table.style);
  const color = tableColor(table);
  if (row === bounds.top)
    return filledHeader
      ? { background: color, color: '#ffffff', bold: true, header: table }
      : { bold: true, borderBottom: `1px solid ${color}`, header: table };
  if (table.totalsRow && row === bounds.bottom)
    return { bold: true, borderTop: `3px double ${color}` };
  const striped =
    (table.bandedRows && (row - bounds.top - 1) % 2 === 0) ||
    (!!table.bandedColumns && (column - bounds.left) % 2 === 0);
  const emphasized =
    (table.firstColumn && column === bounds.left) ||
    (table.lastColumn && column === bounds.right);
  return {
    ...(striped && { stripe: color }),
    ...(emphasized && { bold: true }),
  };
}

/** `color` mixed with white, as a stripe looks on a white sheet. */
function tint(color: string, amount: number) {
  const channel = (offset: number) => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16);
    return Math.round(value * amount + 255 * (1 - amount))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/**
 * Formatting that draws a table's look into its cells, for converting it to
 * a range: cells keep their own fill, text color and borders.
 */
export function tableLookEdits(
  table: SheetTable,
  cells: SpreadsheetCells
): SpreadsheetCellEdits {
  const bounds = tableBounds(table);
  const edits: SpreadsheetCellEdits = {};
  for (let row = bounds.top; row <= bounds.bottom; row++)
    for (let column = bounds.left; column <= bounds.right; column++) {
      const look = tableCellLook([table], row, column);
      if (!look) continue;
      const address = formatCellAddress(row, column);
      const cell = cells[address];
      const edit: SpreadsheetCellEdits[string] = {};
      const fill = look.background ?? (look.stripe && tint(look.stripe, 0.2));
      if (fill && !cell?.fillColor) edit.fillColor = fill;
      if (look.color && !cell?.textColor) edit.textColor = look.color;
      if (look.bold && !cell?.bold) edit.bold = true;
      const border = (look.borderBottom ?? look.borderTop)?.split(' ');
      if (border && look.borderBottom && !cell?.borderBottom)
        Object.assign(edit, {
          borderBottom: true,
          borderBottomStyle: 'thin',
          borderBottomColor: border[2],
        });
      if (border && look.borderTop && !cell?.borderTop)
        Object.assign(edit, {
          borderTop: true,
          borderTopStyle: 'double',
          borderTopColor: border[2],
        });
      if (Object.keys(edit).length) edits[address] = edit;
    }
  return edits;
}
