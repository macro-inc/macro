import {
  cellPlainText,
  cellTextParts,
} from '@macro-inc/spreadsheet/cell-mentions';
import type { CellCopy, SpreadsheetCalculation } from './calculation';
import { csvCellValue } from './csv-value';
import {
  type CellSelection,
  cellAddress,
  parseClipboard,
  positionFromAddress,
  selectionAddresses,
  selectionBounds,
} from './grid-selection';
import {
  SPREADSHEET_COLUMNS,
  SPREADSHEET_MAX_CELL_LENGTH,
  SPREADSHEET_MAX_ROWS,
  type SpreadsheetCellEdits,
  type SpreadsheetCells,
} from './spreadsheet-document';

export function borderEdits(
  selection: CellSelection,
  border: 'all' | 'outer' | 'none'
): SpreadsheetCellEdits {
  const bounds = selectionBounds(selection);
  return Object.fromEntries(
    selectionAddresses(selection).map((address) => {
      const position = positionFromAddress(address)!;
      return [
        address,
        {
          borderTop:
            border === 'all' ||
            (border === 'outer' && position.row === bounds.top),
          borderBottom:
            border === 'all' ||
            (border === 'outer' && position.row === bounds.bottom),
          borderLeft:
            border === 'all' ||
            (border === 'outer' && position.column === bounds.left),
          borderRight:
            border === 'all' ||
            (border === 'outer' && position.column === bounds.right),
        },
      ];
    })
  );
}

/** Sort entire selected rows together using the active column as the key. */
export function sortedRangeCopies(
  cells: SpreadsheetCells,
  values: SpreadsheetCalculation,
  selection: CellSelection,
  descending: boolean,
  keyColumn = selection.anchor.column
): CellCopy[] {
  const { top, bottom, left, right } = selectionBounds(selection);
  const rows = Array.from(
    { length: bottom - top + 1 },
    (_, index) => top + index
  );
  const key = (row: number) => {
    const address = cellAddress({ row, column: keyColumn });
    return (
      values[address]?.number ??
      values[address]?.display ??
      cells[address]?.value ??
      ''
    );
  };
  rows.sort((a, b) => {
    const first = key(a);
    const second = key(b);
    // Empty rows stay at the bottom for either direction.
    if (first === '' || second === '')
      return Number(first === '') - Number(second === '');
    const order =
      typeof first === 'number' && typeof second === 'number'
        ? first - second
        : String(first).localeCompare(String(second), 'en', {
            numeric: true,
            sensitivity: 'base',
          });
    return (descending ? -order : order) || a - b;
  });
  return rows.flatMap((row, index) =>
    Array.from({ length: right - left + 1 }, (_, offset) => {
      const column = left + offset;
      return {
        from: { row, column },
        to: { row: top + index, column },
        cell: cells[cellAddress({ row, column })] ?? { value: '' },
      };
    })
  );
}

export function trimWhitespaceEdits(
  cells: SpreadsheetCells,
  selection: CellSelection
): SpreadsheetCellEdits {
  const edits: SpreadsheetCellEdits = {};
  for (const address of selectionAddresses(selection)) {
    const value = cells[address]?.value;
    if (!value || (value.startsWith('=') && cells[address]?.format !== 'text'))
      continue;
    const trimmed = cellTextParts(value)
      .map((part) =>
        part.mention ? part.text : part.text.replace(/[\t ]+/g, ' ')
      )
      .join('')
      .trim();
    if (trimmed !== value) edits[address] = { value: trimmed };
  }
  return edits;
}

/** Import into the selection; a failed validation produces no partial edits. */
export function csvImportEdits(text: string, selection: CellSelection) {
  if (text.length > 1_000_000) throw new Error('Import a CSV up to 1 MB.');
  if (!text.replace(/^\uFEFF/, '')) throw new Error('This CSV is empty.');
  const rows = parseClipboard(text.replace(/^\uFEFF/, ''), ',');
  const width = Math.max(0, ...rows.map((row) => row.length));
  const start = selection.anchor;
  const lastRow = start.row + rows.length;
  if (!rows.length || !width) throw new Error('This CSV is empty.');
  if (
    lastRow > SPREADSHEET_MAX_ROWS ||
    start.column + width > SPREADSHEET_COLUMNS
  )
    throw new Error(
      'The imported table must fit within 1,000 rows and 26 columns.'
    );
  const edits: SpreadsheetCellEdits = {};
  rows.forEach((row, index) => {
    for (let column = 0; column < width; column++) {
      const value = row[column] ?? '';
      if (value.length > SPREADSHEET_MAX_CELL_LENGTH)
        throw new Error('A cell can contain up to 10,000 characters.');
      edits[
        cellAddress({ row: start.row + index, column: start.column + column })
      ] = { value: csvCellValue(value) };
    }
  });
  return {
    edits,
    rowCount: lastRow,
    selection: {
      anchor: start,
      focus: { row: lastRow - 1, column: start.column + width - 1 },
    },
  };
}

export type FindOptions = {
  matchCase: boolean;
  entireCell: boolean;
  formulas: boolean;
};

export function findCells(
  cells: SpreadsheetCells,
  values: SpreadsheetCalculation,
  query: string,
  options: FindOptions
) {
  if (!query) return [];
  const normalize = (value: string) =>
    options.matchCase ? value : value.toLocaleLowerCase();
  const needle = normalize(query);
  return [...new Set([...Object.keys(cells), ...Object.keys(values)])]
    .filter((address) => {
      const text = normalize(
        cellPlainText(
          options.formulas
            ? (cells[address]?.value ?? '')
            : (values[address]?.display ?? cells[address]?.value ?? '')
        )
      );
      return options.entireCell ? text === needle : text.includes(needle);
    })
    .sort((a, b) => {
      const first = positionFromAddress(a)!;
      const second = positionFromAddress(b)!;
      return first.row - second.row || first.column - second.column;
    });
}

export function replaceCellText(
  text: string,
  query: string,
  replacement: string,
  options: FindOptions
) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = options.entireCell ? `^${escaped}$` : escaped;
  const parts = cellTextParts(text);
  if (options.entireCell && parts.some((part) => part.mention)) return text;
  return parts
    .map((part) =>
      part.mention
        ? part.text
        : part.text.replace(
            new RegExp(pattern, options.matchCase ? 'g' : 'gi'),
            () => replacement
          )
    )
    .join('');
}
