import {
  formatCellAddress,
  parseCellAddress,
  SPREADSHEET_COLUMNS,
  SPREADSHEET_ROWS,
} from './spreadsheet-document';

export type CellPosition = { row: number; column: number };
export type CellSelection = { anchor: CellPosition; focus: CellPosition };

export const GRID_ROWS = SPREADSHEET_ROWS;
export const GRID_COLUMNS = SPREADSHEET_COLUMNS;

export function cellAddress(position: CellPosition): string {
  return formatCellAddress(position.row, position.column);
}

export function positionFromAddress(address: string): CellPosition | undefined {
  return parseCellAddress(address.trim().toUpperCase());
}

export function selectionBounds(selection: CellSelection) {
  return {
    top: Math.min(selection.anchor.row, selection.focus.row),
    bottom: Math.max(selection.anchor.row, selection.focus.row),
    left: Math.min(selection.anchor.column, selection.focus.column),
    right: Math.max(selection.anchor.column, selection.focus.column),
  };
}

export function selectionAddresses(selection: CellSelection): string[] {
  const { top, bottom, left, right } = selectionBounds(selection);
  const addresses: string[] = [];
  for (let row = top; row <= bottom; row++) {
    for (let column = left; column <= right; column++) {
      addresses.push(cellAddress({ row, column }));
    }
  }
  return addresses;
}

/** Parse tabular clipboard text, including quoted fields from Excel and Sheets. */
export function parseClipboard(text: string, separator = '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"' && (quoted || field === '')) {
      if (quoted && input[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (char === separator || char === '\n')) {
      row.push(field);
      field = '';
      if (char === '\n') {
        rows.push(row);
        row = [];
      }
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('The pasted table has an unclosed quoted cell.');
  if (field || row.length || !input.endsWith('\n')) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function serializeTable(rows: string[][], separator = '\t'): string {
  return rows
    .map((row) =>
      row
        .map((value) =>
          value.includes(separator) || /["\n\r]/.test(value)
            ? `"${value.replaceAll('"', '""')}"`
            : value
        )
        .join(separator)
    )
    .join('\n');
}

/** CSV exports are values, so text must not become executable formulas on import. */
export function safeCsvValue(value: string, numeric: boolean): string {
  return !numeric && /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
}
