import { describe, expect, it } from 'vitest';
import { selectionToggleStyles } from './selection-formatting';
import type { SpreadsheetCells } from './spreadsheet-document';

describe('selection formatting state', () => {
  const column = {
    anchor: { row: 0, column: 0 },
    focus: { row: 199, column: 0 },
  };

  it('does not treat a bold column header as a fully bold column', () => {
    expect(
      selectionToggleStyles(
        { A1: { value: 'Revenue', bold: true }, A2: { value: '100' } },
        column
      ).bold
    ).toBe(false);
  });

  it('recognizes uniformly formatted whole columns, including blank cells', () => {
    const cells: SpreadsheetCells = Object.fromEntries(
      Array.from({ length: 200 }, (_, row) => [
        `A${row + 1}`,
        { value: row < 2 ? 'Amount' : '', bold: true, wrap: true },
      ])
    );
    expect(selectionToggleStyles(cells, column)).toEqual({
      bold: true,
      italic: false,
      underline: false,
      strikethrough: false,
      wrap: true,
    });
    delete cells.A100;
    expect(selectionToggleStyles(cells, column).bold).toBe(false);
  });

  it('reports each toggle independently across reverse row selections', () => {
    const styles = selectionToggleStyles(
      {
        A1: { value: 'A', bold: true, italic: true, underline: true },
        B1: { value: 'B', italic: true, underline: true },
        C1: { value: 'C', italic: true },
      },
      { anchor: { row: 0, column: 2 }, focus: { row: 0, column: 0 } }
    );
    expect(styles).toEqual({
      bold: false,
      italic: true,
      underline: false,
      strikethrough: false,
      wrap: false,
    });
  });
});
