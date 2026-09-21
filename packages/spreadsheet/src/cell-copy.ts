import type { CellCopy } from './calculation';
import { inferFillSeries } from './fill-series';
import {
  type CellPosition,
  type CellSelection,
  cellAddress,
  selectionBounds,
} from './grid-selection';
import {
  isSpreadsheetCellStyle,
  SPREADSHEET_COLUMNS,
  SPREADSHEET_MAX_CELL_LENGTH,
  SPREADSHEET_MAX_ROWS,
  type SpreadsheetCell,
  type SpreadsheetCells,
} from './spreadsheet-document';

export const SPREADSHEET_CLIPBOARD_TYPE = 'application/x-macro-spreadsheet';
export type CopiedRange = {
  version: 1;
  cut?: boolean;
  top: number;
  left: number;
  cells: SpreadsheetCell[][];
};

export function copyRange(
  cells: SpreadsheetCells,
  selection: CellSelection
): CopiedRange {
  const { top, bottom, left, right } = selectionBounds(selection);
  return {
    version: 1,
    top,
    left,
    cells: Array.from({ length: bottom - top + 1 }, (_, row) =>
      Array.from({ length: right - left + 1 }, (_, column) => ({
        ...(cells[cellAddress({ row: top + row, column: left + column })] ?? {
          value: '',
        }),
      }))
    ),
  };
}

export function readCopiedRange(text: string): CopiedRange | undefined {
  if (!text || text.length > 4_000_000) return;
  try {
    const value: unknown = JSON.parse(text);
    if (
      !value ||
      typeof value !== 'object' ||
      !('version' in value) ||
      value.version !== 1 ||
      !('top' in value) ||
      !('left' in value) ||
      !('cells' in value)
    )
      return;
    const { top, left, cells } = value;
    if ('cut' in value && typeof value.cut !== 'boolean') return;
    if (
      typeof top !== 'number' ||
      !Number.isInteger(top) ||
      top < 0 ||
      typeof left !== 'number' ||
      !Number.isInteger(left) ||
      left < 0 ||
      !Array.isArray(cells) ||
      !cells.length ||
      top + cells.length > SPREADSHEET_MAX_ROWS
    )
      return;
    const width = Array.isArray(cells[0]) ? cells[0].length : 0;
    if (!width || left + width > SPREADSHEET_COLUMNS) return;
    const valid = cells.every(
      (row: unknown) =>
        Array.isArray(row) &&
        row.length === width &&
        row.every((cell: unknown) => {
          if (
            !cell ||
            typeof cell !== 'object' ||
            !('value' in cell) ||
            typeof cell.value !== 'string' ||
            cell.value.length > SPREADSHEET_MAX_CELL_LENGTH
          )
            return false;
          return isSpreadsheetCellStyle(cell);
        })
    );
    return valid
      ? {
          version: 1,
          top,
          left,
          cells,
          ...('cut' in value && value.cut === true && { cut: true }),
        }
      : undefined;
  } catch {
    return;
  }
}

export function rangeCopies(
  range: CopiedRange,
  target: CellPosition
): CellCopy[] {
  return range.cells.flatMap((row, rowIndex) =>
    row.map((cell, columnIndex) => ({
      from: { row: range.top + rowIndex, column: range.left + columnIndex },
      to: { row: target.row + rowIndex, column: target.column + columnIndex },
      cell,
    }))
  );
}

/** Extend numeric/date sequences; repeat text and translate formulas. */
export function fillCopies(
  cells: SpreadsheetCells,
  source: CellSelection,
  target: CellSelection,
  mode: 'series' | 'copy' = 'series'
): CellCopy[] {
  const from = selectionBounds(source);
  const to = selectionBounds(target);
  const copies: CellCopy[] = [];
  const vertical = to.left === from.left && to.right === from.right;
  const horizontal = to.top === from.top && to.bottom === from.bottom;
  const series = new Map<number, ReturnType<typeof inferFillSeries>>();
  if (mode === 'series' && (vertical || horizontal)) {
    const start = vertical ? from.left : from.top;
    const end = vertical ? from.right : from.bottom;
    for (let lane = start; lane <= end; lane++) {
      const entries: SpreadsheetCell[] = [];
      for (
        let index = vertical ? from.top : from.left;
        index <= (vertical ? from.bottom : from.right);
        index++
      ) {
        entries.push(
          cells[
            cellAddress({
              row: vertical ? index : lane,
              column: vertical ? lane : index,
            })
          ] ?? { value: '' }
        );
      }
      series.set(lane, inferFillSeries(entries));
    }
  }
  const mod = (value: number, size: number) => ((value % size) + size) % size;
  for (let row = to.top; row <= to.bottom; row++) {
    for (let column = to.left; column <= to.right; column++) {
      if (
        row >= from.top &&
        row <= from.bottom &&
        column >= from.left &&
        column <= from.right
      )
        continue;
      const position = {
        row: from.top + mod(row - from.top, from.bottom - from.top + 1),
        column: from.left + mod(column - from.left, from.right - from.left + 1),
      };
      const cell = cells[cellAddress(position)] ?? { value: '' };
      const generated = series.get(vertical ? column : row)?.(
        vertical ? row - from.top : column - from.left
      );
      copies.push({
        from: position,
        to: { row, column },
        cell: generated === undefined ? cell : { ...cell, value: generated },
      });
    }
  }
  return copies;
}
