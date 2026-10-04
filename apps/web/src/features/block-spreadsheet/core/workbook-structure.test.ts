import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@ironcalc/wasm';
import { changeWorkbookAxis } from '@macro-inc/spreadsheet/workbook-structure';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SpreadsheetWorkbookSheet } from './workbook-document';

beforeAll(() =>
  initSync({
    module: readFileSync(
      createRequire(import.meta.url).resolve('@ironcalc/wasm/wasm_bg.wasm')
    ),
  })
);
const workbook = (): SpreadsheetWorkbookSheet[] => [
  {
    id: 'one',
    name: 'Inputs',
    cells: {
      A1: { value: '10', bold: true },
      A2: { value: '20' },
      B2: { value: '=SUM($A$1:A2)' },
      C1: { value: '=A1', format: 'text' },
    },
    layout: { rowCount: 200, columnCount: 26, columnWidths: { 0: 180, 1: 90 } },
    metadata: {
      hiddenRows: [1],
      hiddenColumns: [1],
      rowHeights: { 1: 30 },
      merges: ['C3:D3'],
      autoFilter: 'A1:B3',
      freeze: { rows: 1, columns: 1 },
      definedNames: [{ name: 'Revenue', formula: 'Inputs!$A$1:$A$2' }],
    },
  },
  {
    id: 'two',
    name: 'Model',
    cells: { A1: { value: '=Inputs!A2+Inputs!$A$1' }, A2: { value: '="A2"' } },
    layout: { rowCount: 200, columnCount: 26, columnWidths: {} },
  },
];
describe('row and column structure', () => {
  it('inserts rows with absolute, relative, cross-sheet and named references, retaining styles and layout', () => {
    const before = workbook();
    const next = changeWorkbookAxis(before, {
      sheetId: 'one',
      axis: 'row',
      index: 0,
      count: 2,
      kind: 'insert',
    });
    expect(next[0].cells.A3).toEqual({ value: '10', bold: true });
    expect(next[0].cells.B4.value).toBe('=SUM($A$3:A4)');
    expect(next[0].cells.C3).toEqual({ value: '=A1', format: 'text' });
    expect(next[1].cells.A1.value).toBe('=Inputs!A4+Inputs!$A$3');
    expect(next[1].cells.A2.value).toBe('="A2"');
    expect(next[0].metadata).toMatchObject({
      hiddenRows: [3],
      rowHeights: { 3: 30 },
      merges: ['C5:D5'],
      autoFilter: 'A3:B5',
      freeze: { rows: 3, columns: 1 },
    });
    expect(next[0].metadata?.definedNames?.[0].formula).toContain('$A$3:$A$4');
    expect(before[0].cells.A1.value).toBe('10');
  });
  it('shrinks a partly deleted formula range and keeps an unfrozen axis unfrozen', () => {
    const sheets = workbook();
    sheets[0].cells.B3 = { value: '=SUM($A$1:A2)' };
    sheets[0].metadata!.freeze = { rows: 0, columns: 1 };
    const inserted = changeWorkbookAxis(sheets, {
      sheetId: 'one',
      axis: 'row',
      index: 0,
      count: 1,
      kind: 'insert',
    });
    expect(inserted[0].metadata?.freeze).toEqual({ rows: 0, columns: 1 });
    const removed = changeWorkbookAxis(sheets, {
      sheetId: 'one',
      axis: 'row',
      index: 0,
      count: 1,
      kind: 'delete',
    });
    expect(removed[0].cells.B2.value).toBe('=SUM($A$1:A1)');
  });
  it('deletes referenced columns as #REF and moves column widths, hidden state and remaining cells', () => {
    const next = changeWorkbookAxis(workbook(), {
      sheetId: 'one',
      axis: 'column',
      index: 0,
      count: 1,
      kind: 'delete',
    });
    expect(next[0].cells.A2.value).toContain('#REF!');
    expect(next[1].cells.A1.value).toContain('#REF!');
    expect(next[0].cells.B1.value).toBe('=A1');
    expect(next[0].layout.columnWidths).toEqual({ 0: 90 });
    expect(next[0].metadata?.hiddenColumns).toEqual([0]);
    expect(next[0].metadata?.merges).toEqual(['B3:C3']);
  });
  it('refuses to push occupied trailing cells beyond limits without modifying input', () => {
    const sheets = workbook();
    sheets[0].cells.XFD1 = { value: 'Keep me' };
    const before = JSON.stringify(sheets);
    expect(() =>
      changeWorkbookAxis(sheets, {
        sheetId: 'one',
        axis: 'column',
        index: 0,
        count: 1,
        kind: 'insert',
      })
    ).toThrow('push cells');
    expect(JSON.stringify(sheets)).toBe(before);
  });
  it('shrinks overlapping ranges and removes wholly deleted merges', () => {
    const sheets = workbook();
    sheets[0].metadata = { merges: ['A2:B3', 'C5:D7'], hiddenRows: [1, 2, 6] };
    const next = changeWorkbookAxis(sheets, {
      sheetId: 'one',
      axis: 'row',
      index: 1,
      count: 3,
      kind: 'delete',
    });
    expect(next[0].metadata?.merges).toEqual(['C2:D4']);
    expect(next[0].metadata?.hiddenRows).toEqual([3]);
  });
  it('moves notes, rule ranges and rule formulas with their cells', () => {
    const sheets = workbook();
    sheets[0].metadata = {
      notes: { A1: 'Header', A3: 'Removed', B5: 'Kept' },
      conditionalFormats: [
        {
          range: 'A2:A10 C4',
          type: 'expression',
          formulas: ['$A2>$B$1'],
        },
        { range: 'D3', type: 'containsBlanks' },
        {
          range: 'E1:E9',
          type: 'colorScale',
          thresholds: [{ type: 'min' }, { type: 'num', value: '$B$6' }],
          colors: ['#FFFFFF', '#00FF00'],
        },
      ],
      validations: [
        { range: 'F2:F99999', type: 'list', formulas: ['Model!$A$1:$A$4'] },
        { range: 'G6', type: 'whole', formulas: ['$B$6', '100'] },
      ],
      drawings: [
        {
          id: 'chart',
          type: 'chart',
          from: { row: 4, column: 2, x: 5, y: 6 },
          to: { row: 9, column: 6, x: 7, y: 8 },
          chart: {
            plots: [{ kind: 'column', series: [{ values: 1, categories: 0 }] }],
            references: ['Inputs!$A$4:$A$9', "'Inputs'!$B$4:$B$9"],
          },
        },
        {
          id: 'logo',
          type: 'image',
          image: '0123456789abcdef',
          from: { row: 2, column: 0, x: 3, y: 4 },
          width: 120,
          height: 40,
        },
      ],
    };
    const deleted = changeWorkbookAxis(sheets, {
      sheetId: 'one',
      axis: 'row',
      index: 2,
      count: 1,
      kind: 'delete',
    });
    expect(deleted[0].metadata).toMatchObject({
      notes: { A1: 'Header', B4: 'Kept' },
      conditionalFormats: [
        { range: 'A2:A9 C3', formulas: ['$A2>$B$1'] },
        {
          range: 'E1:E8',
          thresholds: [{ type: 'min' }, { type: 'num', value: '$B$5' }],
        },
      ],
      validations: [
        { range: 'F2:F99998', formulas: ['Model!$A$1:$A$4'] },
        { range: 'G5', formulas: ['$B$5', '100'] },
      ],
    });
    expect(deleted[0].metadata?.conditionalFormats).toHaveLength(2);
    // The image's row was deleted: it moves to where the row was.
    expect(deleted[0].metadata?.drawings).toMatchObject([
      {
        id: 'chart',
        from: { row: 3, column: 2, x: 5, y: 6 },
        to: { row: 8, column: 6, x: 7, y: 8 },
        chart: { references: ['Inputs!$A$3:$A$8', 'Inputs!$B$3:$B$8'] },
      },
      { id: 'logo', from: { row: 2, column: 0, x: 3, y: 0 } },
    ]);
    // Rows inserted above move a rule; its range is clipped at the sheet's
    // last row instead of blocking the insertion.
    const inserted = changeWorkbookAxis(sheets, {
      sheetId: 'one',
      axis: 'row',
      index: 0,
      count: 2,
      kind: 'insert',
    });
    expect(inserted[0].metadata?.conditionalFormats?.[0]).toMatchObject({
      range: 'A4:A12 C6',
      formulas: ['$A4>$B$3'],
    });
    expect(inserted[0].metadata?.validations?.[0].range).toBe('F4:F100000');
    expect(inserted[0].metadata?.drawings?.[0]).toMatchObject({
      from: { row: 6 },
      to: { row: 11 },
      chart: { references: ['Inputs!$A$6:$A$11', 'Inputs!$B$6:$B$11'] },
    });
    // Another sheet's rows move rules that refer to them.
    const model = changeWorkbookAxis(sheets, {
      sheetId: 'two',
      axis: 'row',
      index: 0,
      count: 1,
      kind: 'insert',
    });
    expect(model[0].metadata?.validations?.[0]).toMatchObject({
      range: 'F2:F99999',
      formulas: ['Model!$A$2:$A$5'],
    });
  });
});

it('moves pivot tables with their cells and source, and drops ones without a source', () => {
  const sheets = workbook();
  const pivot = (location: string, source: string) => ({
    table: '<pivotTableDefinition name="Summary"/>',
    cache: '<pivotCacheDefinition/>',
    location,
    source,
  });
  sheets[0].metadata = {
    pivotTables: [
      pivot('H3:I8', 'Model!$A$1:$B$4'),
      pivot('K1', "'Inputs'!$A:$B"),
    ],
  };
  // Rows of the source's sheet move the source; the table stays.
  const model = changeWorkbookAxis(sheets, {
    sheetId: 'two',
    axis: 'row',
    index: 0,
    count: 1,
    kind: 'insert',
  });
  expect(model[0].metadata?.pivotTables).toMatchObject([
    { location: 'H3:I8', source: 'Model!$A$2:$B$5' },
    { location: 'K1', source: 'Inputs!$A:$B' },
  ]);
  // Rows of the table's sheet move it; one whose cells all go is removed.
  const deleted = changeWorkbookAxis(sheets, {
    sheetId: 'one',
    axis: 'row',
    index: 0,
    count: 2,
    kind: 'delete',
  });
  expect(deleted[0].metadata?.pivotTables).toMatchObject([
    { location: 'H1:I6', source: 'Model!$A$1:$B$4' },
  ]);
  // Without its source cells, a pivot table keeps only its values.
  const gone = changeWorkbookAxis(sheets, {
    sheetId: 'two',
    axis: 'column',
    index: 0,
    count: 2,
    kind: 'delete',
  });
  expect(gone[0].metadata?.pivotTables).toMatchObject([
    { location: 'K1', source: 'Inputs!$A:$B' },
  ]);
});

it.each([
  ['row', '=SUM(1:2)', '=SUM(1:1)'],
  ['row', '=SUM(A:A)', '=SUM(A:A)'],
  ['column', '=SUM(A:B)', '=SUM(A:A)'],
  ['column', '=SUM(1:1)', '=SUM(1:1)'],
] as const)(
  'preserves whole-axis syntax on %s deletion: %s',
  (axis, formula, expected) => {
    const sheets = workbook();
    sheets[0].cells = { C3: { value: formula } };
    sheets[0].metadata = undefined;
    const next = changeWorkbookAxis(sheets, {
      sheetId: 'one',
      axis,
      index: 0,
      count: 1,
      kind: 'delete',
    });
    expect(next[0].cells[axis === 'row' ? 'C2' : 'B3'].value).toBe(expected);
  }
);
