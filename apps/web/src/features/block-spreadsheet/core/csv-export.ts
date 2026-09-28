import type { SpreadsheetCalculation } from './calculation';
import {
  cellAddress,
  positionFromAddress,
  safeCsvValue,
  serializeTable,
} from './grid-selection';
import type { SpreadsheetCells } from './spreadsheet-document';

/** Export raw numeric results (never rounded UI labels), with RFC 4180 quoting
 * and protection against executing formula-like text in external applications. */
export function encodeCsv(
  cells: SpreadsheetCells,
  values: SpreadsheetCalculation
) {
  const positions = [
    ...new Set([...Object.keys(cells), ...Object.keys(values)]),
  ]
    .map(positionFromAddress)
    .filter((position) => position !== undefined);
  const bottom = Math.max(0, ...positions.map((position) => position.row));
  const right = Math.max(0, ...positions.map((position) => position.column));
  return serializeTable(
    Array.from({ length: bottom + 1 }, (_, row) =>
      Array.from({ length: right + 1 }, (_, column) => {
        const address = cellAddress({ row, column });
        const result = values[address];
        return safeCsvValue(
          result?.number !== undefined
            ? String(result.number)
            : (result?.display ??
                cells[address]?.value.replace(/^'/, '') ??
                ''),
          result?.number !== undefined
        );
      })
    ),
    ','
  );
}
