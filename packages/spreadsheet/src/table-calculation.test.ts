import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@ironcalc/wasm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CalculationSheet,
  createInitializedSpreadsheetCalculator,
  type SpreadsheetCalculator,
} from './calculation';
import type { SheetTable } from './sheet-tables';
import type { SpreadsheetCells } from './spreadsheet-document';
import type { SpreadsheetWorkbookSheet } from './workbook-document';

let calculator: SpreadsheetCalculator;
beforeAll(() => {
  initSync({
    module: readFileSync(
      createRequire(import.meta.url).resolve('@ironcalc/wasm/wasm_bg.wasm')
    ),
  });
  calculator = createInitializedSpreadsheetCalculator();
});
afterAll(() => calculator.dispose());

const table: SheetTable = {
  name: 'Sales',
  range: 'A1:D5',
  totalsRow: true,
  bandedRows: true,
};
const cells: SpreadsheetCells = {
  A1: { value: 'Item' },
  B1: { value: 'Qty' },
  C1: { value: 'Price' },
  D1: { value: 'Amount' },
  A2: { value: 'Pens' },
  B2: { value: '2' },
  C2: { value: '1.5' },
  A3: { value: 'Ink' },
  B3: { value: '3' },
  C3: { value: '4' },
  A4: { value: 'Pads' },
  B4: { value: '5' },
  C4: { value: '2' },
  A5: { value: 'Total' },
  B5: { value: '=SUBTOTAL(109,[Qty])' },
  D2: { value: '=[@Qty]*[@Price]' },
};

function workbook(
  sheetCells: SpreadsheetCells,
  hiddenRows?: number[]
): CalculationSheet[] {
  return [
    {
      id: 'data',
      name: 'Data',
      cells: sheetCells,
      rowCount: 200,
      metadata: { tables: [table], ...(hiddenRows && { hiddenRows }) },
    },
    {
      id: 'summary',
      name: 'Summary',
      cells: {
        A1: { value: '=SUM(Sales[Qty])' },
        A2: { value: '=Sales[#Totals]' },
        A3: { value: '=SUM(Sales[Missing])' },
        A4: { value: '=COUNTA(Sales[[#Headers],[Item]:[Price]])' },
      },
      rowCount: 200,
    },
  ];
}

describe('table references in calculation', () => {
  it('calculates column, this-row, total and header references', () => {
    const results = calculator.calculateWorkbook(workbook(cells));
    expect(results.data.B5.display).toBe('10');
    expect(results.data.D2.display).toBe('3');
    expect(results.summary.A1.display).toBe('10');
    expect(results.summary.A2.display).toBe('Total');
    expect(results.summary.A3.display).toBe('#REF!');
    expect(results.summary.A4.display).toBe('3');
  });

  it('follows header renames and leaves filtered rows out of the total', () => {
    const renamed = calculator.calculateWorkbook(
      workbook({ ...cells, B1: { value: 'Count' } })
    );
    expect(renamed.summary.A1.display).toBe('#REF!');
    expect(renamed.data.B5.display).toBe('#REF!');
    const filtered = calculator.calculateWorkbook(workbook(cells, [2]));
    expect(filtered.data.B5.display).toBe('7');
    expect(filtered.summary.A1.display).toBe('10');
  });

  it('leaves rows a filter hides out of SUBTOTAL(1-11) too, but not rows hidden by hand', () => {
    const sheet = (filtered: boolean): CalculationSheet[] => [
      {
        id: 'data',
        name: 'Data',
        cells: { ...cells, B5: { value: '=SUBTOTAL(9,[Qty])' } },
        rowCount: 200,
        metadata: {
          tables: [
            filtered
              ? { ...table, filters: { 0: { values: ['Pens'] } } }
              : table,
          ],
          hiddenRows: [2],
        },
      },
    ];
    expect(calculator.calculateWorkbook(sheet(false)).data.B5.display).toBe(
      '10'
    );
    expect(calculator.calculateWorkbook(sheet(true)).data.B5.display).toBe('7');
  });

  it('reads a bare table name as its data and calculates every footer aggregate', () => {
    const results = calculator.calculateWorkbook([
      {
        id: 'data',
        name: 'Data',
        cells: {
          ...cells,
          A4: { value: 'Pens' },
          C4: { value: '' },
          F1: { value: '=ROWS(Sales)' },
          F2: { value: '=COUNTBLANK(Sales[Price])' },
          F3: {
            value:
              '=SUMPRODUCT((Sales[Item]<>"")/COUNTIF(Sales[Item],Sales[Item]&""))',
          },
          F4: { value: '=SUBTOTAL(103,Sales[Price])/ROWS(Sales[Price])' },
        },
        rowCount: 200,
        metadata: { tables: [table] },
      },
    ]);
    expect(results.data.F1.display).toBe('3');
    expect(results.data.F2.display).toBe('1');
    expect(results.data.F3.display).toBe('2');
    expect(Number(results.data.F4.number?.toFixed(4))).toBe(0.6667);
  });

  it('copies table references as written while other references move', () => {
    expect(
      calculator.copy([
        {
          from: { row: 1, column: 4 },
          to: { row: 2, column: 4 },
          cell: { value: '=[@Qty]*$C$2+B2+Sales[[#Totals],[Qty]]' },
        },
      ]).E3.value
    ).toBe('=[@Qty]*$C$2+B3+Sales[[#Totals],[Qty]]');
  });
});

describe('tables when rows and columns move', () => {
  const sheets = (): SpreadsheetWorkbookSheet[] => [
    {
      id: 'data',
      name: 'Data',
      cells: {
        ...cells,
        E1: { value: '=SUM(Sales[Qty])+B7' },
      },
      layout: { rowCount: 200, columnCount: 26, columnWidths: {} },
      metadata: {
        tables: [{ ...table, filters: { 2: { values: ['4'] } } }],
        hiddenRows: [1],
      },
    },
  ];

  it('grows a table when rows are inserted inside it and keeps its references', () => {
    const [sheet] = calculator.changeAxis(sheets(), {
      sheetId: 'data',
      axis: 'row',
      index: 2,
      count: 2,
      kind: 'insert',
    });
    expect(sheet.metadata?.tables?.[0].range).toBe('A1:D7');
    expect(sheet.metadata?.hiddenRows).toEqual([1]);
    expect(sheet.cells.E1.value).toBe('=SUM(Sales[Qty])+B9');
    expect(sheet.cells.D2.value).toBe('=[@Qty]*[@Price]');
  });

  it('moves a table down when rows are inserted above it, not below it', () => {
    const [moved] = calculator.changeAxis(sheets(), {
      sheetId: 'data',
      axis: 'row',
      index: 0,
      count: 1,
      kind: 'insert',
    });
    expect(moved.metadata?.tables?.[0].range).toBe('A2:D6');
    const [below] = calculator.changeAxis(sheets(), {
      sheetId: 'data',
      axis: 'row',
      index: 5,
      count: 1,
      kind: 'insert',
    });
    expect(below.metadata?.tables?.[0].range).toBe('A1:D5');
  });

  it('drops deleted columns and moves the filters of the others', () => {
    const [sheet] = calculator.changeAxis(sheets(), {
      sheetId: 'data',
      axis: 'column',
      index: 0,
      count: 1,
      kind: 'delete',
    });
    expect(sheet.metadata?.tables?.[0]).toMatchObject({
      range: 'A1:C5',
      filters: { 1: { values: ['4'] } },
    });
  });

  it('removes a table with its header row and its total row with that row', () => {
    const [header] = calculator.changeAxis(sheets(), {
      sheetId: 'data',
      axis: 'row',
      index: 0,
      count: 1,
      kind: 'delete',
    });
    expect(header.metadata?.tables).toBeUndefined();
    const [totals] = calculator.changeAxis(sheets(), {
      sheetId: 'data',
      axis: 'row',
      index: 4,
      count: 1,
      kind: 'delete',
    });
    expect(totals.metadata?.tables?.[0]).toMatchObject({
      range: 'A1:D4',
      totalsRow: false,
    });
    expect(() =>
      calculator.changeAxis(sheets(), {
        sheetId: 'data',
        axis: 'row',
        index: 1,
        count: 3,
        kind: 'delete',
      })
    ).toThrow('Keep at least one data row');
  });
});
