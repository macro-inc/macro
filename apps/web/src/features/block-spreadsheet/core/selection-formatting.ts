import {
  type CellSelection,
  cellAddress,
  selectionBounds,
} from './grid-selection';
import type { SpreadsheetCells } from './spreadsheet-document';

/** Mixed selections enable a style on the first toggle, including blank cells. */
export function selectionToggleStyles(
  cells: SpreadsheetCells,
  selection: CellSelection
) {
  const styles = {
    bold: true,
    italic: true,
    underline: true,
    strikethrough: true,
    wrap: true,
  };
  const { top, bottom, left, right } = selectionBounds(selection);
  for (let row = top; row <= bottom; row++) {
    for (let column = left; column <= right; column++) {
      const cell = cells[cellAddress({ row, column })];
      styles.bold &&= !!cell?.bold;
      styles.italic &&= !!cell?.italic;
      styles.underline &&= !!cell?.underline;
      styles.strikethrough &&= !!cell?.strikethrough;
      styles.wrap &&= !!cell?.wrap;
      if (
        !styles.bold &&
        !styles.italic &&
        !styles.underline &&
        !styles.strikethrough &&
        !styles.wrap
      )
        return styles;
    }
  }
  return styles;
}
