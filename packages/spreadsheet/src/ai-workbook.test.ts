import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@ironcalc/wasm';
import { LoroDoc } from 'loro-crdt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  calculateSpreadsheetForAi,
  prepareSpreadsheetEdit,
  readSpreadsheetForAi,
} from './ai-workbook';
import {
  createInitializedSpreadsheetCalculator,
  type SpreadsheetCalculator,
} from './calculation';
import { qualifyScratchFormula } from './scratch-formula';
import {
  readSpreadsheetCells,
  writeSpreadsheetCells,
} from './spreadsheet-document';
import {
  addSpreadsheetSheet,
  readSpreadsheetWorkbook,
  renameSpreadsheetSheet,
} from './workbook-document';

let calculator: SpreadsheetCalculator;
const documents: LoroDoc[] = [];
function document() {
  const doc = new LoroDoc();
  doc.getMap('spreadsheetMeta').set('formatVersion', 1);
  doc.commit();
  documents.push(doc);
  return doc;
}
beforeAll(() => {
  initSync({
    module: readFileSync(
      createRequire(import.meta.url).resolve('@ironcalc/wasm/wasm_bg.wasm')
    ),
  });
  calculator = createInitializedSpreadsheetCalculator();
});
afterAll(() => {
  calculator.dispose();
  for (const doc of documents) doc.free();
});

describe('spreadsheet AI reads and calculation', () => {
  it('returns compact workbook inventory, source formulas and accurate typed values independently of formatting', () => {
    const doc = document();
    writeSpreadsheetCells(doc, {
      A1: { value: 'Inputs', bold: true },
      A2: { value: '1234.567', format: 'currency', decimals: 2 },
      B2: { value: '=A2/3', format: 'number', decimals: 1 },
      C2: { value: 'TRUE' },
      D2: { value: 'TRUE', format: 'text' },
      E2: { value: '=1/0' },
      F2: { value: '=IF(TRUE,"",0)' },
    });
    const other = addSpreadsheetSheet(doc, 'Summary');
    writeSpreadsheetCells(doc, { A1: { value: '=Sheet1!A2*2' } }, other);
    const version = doc.version().encode();
    const response = readSpreadsheetForAi(
      doc,
      'version',
      { action: 'read', ranges: ['A1:F2'], includeStyles: true },
      calculator
    );
    expect(response.sheets).toMatchObject([
      {
        name: 'Sheet1',
        usedRange: 'A1:F2',
        populatedCells: 7,
        formulaCells: 3,
        errorCells: 1,
      },
      { name: 'Summary', usedRange: 'A1', formulaCells: 1 },
    ]);
    expect(
      response.ranges[0].cells.find((cell) => cell.address === 'A2')
    ).toMatchObject({
      source: '1234.567',
      value: 1234.567,
      type: 'number',
      display: '$1,234.57',
      style: { format: 'currency' },
    });
    expect(
      response.ranges[0].cells.find((cell) => cell.address === 'B2')
    ).toMatchObject({ formula: '=A2/3', type: 'number', display: '411.5' });
    expect(
      response.ranges[0].cells.find((cell) => cell.address === 'C2')
    ).toMatchObject({ value: true, type: 'boolean' });
    expect(
      response.ranges[0].cells.find((cell) => cell.address === 'D2')
    ).toMatchObject({ value: 'TRUE', type: 'text' });
    expect(
      response.ranges[0].cells.find((cell) => cell.address === 'E2')
    ).toMatchObject({ value: null, type: 'error', display: '#DIV/0!' });
    expect(
      response.ranges[0].cells.find((cell) => cell.address === 'F2')
    ).toMatchObject({ value: '', type: 'text' });
    expect(doc.version().encode()).toEqual(version);
  });

  it('includes spill values without inventing source formulas and bounds sparse output', () => {
    const doc = document();
    writeSpreadsheetCells(doc, { A1: { value: '=SEQUENCE(2,2)' } });
    const response = readSpreadsheetForAi(
      doc,
      'v',
      { action: 'read', ranges: ['A1:B2'] },
      calculator
    );
    expect(
      response.ranges[0].cells.find((cell) => cell.address === 'B2')
    ).toMatchObject({ value: 4, source: '' });
    const entries = Object.fromEntries(
      Array.from({ length: 200 }, (_, row) =>
        ['A', 'B', 'C'].map((column) => [`${column}${row + 1}`, { value: '1' }])
      ).flat()
    );
    writeSpreadsheetCells(doc, entries);
    const bounded = readSpreadsheetForAi(
      doc,
      'v',
      { action: 'read' },
      calculator
    );
    expect(bounded.ranges[0].cells).toHaveLength(500);
    expect(bounded.ranges[0].truncated).toBe(true);
    expect(bounded.warnings).toHaveLength(1);
  });

  it('runs what-if formulas with ordinary, absolute, Unicode, entire-column and cross-sheet references without mutation', () => {
    const doc = document();
    renameSpreadsheetSheet(doc, 'sheet1', "O'Brien 🙂");
    writeSpreadsheetCells(doc, {
      A1: { value: '2' },
      A2: { value: '3' },
      B1: { value: '=C1*2' },
      C1: { value: '5' },
    });
    const summary = addSpreadsheetSheet(doc, 'Summary');
    writeSpreadsheetCells(
      doc,
      { A1: { value: "='O''Brien 🙂'!B1+1" } },
      summary
    );
    const before = doc.toJSON();
    const revision = doc.version().encode();
    const response = calculateSpreadsheetForAi(
      doc,
      'v',
      {
        action: 'calculate',
        sheetId: 'sheet1',
        overrides: [
          { sheetId: 'sheet1', cells: [{ address: 'C1', value: '10' }] },
        ],
        formulas: [
          { label: 'range', formula: '=SUM(A1:A5)' },
          { formula: '=B1' },
          { formula: '=Summary!A1' },
          { formula: '=SUM(A:A)' },
          { formula: '=$A$1+A$2' },
          { formula: '=IF(TRUE,"é🙂"& A1,"no")' },
        ],
      },
      calculator
    );
    expect(response.results.map((item) => item.value)).toEqual([
      5,
      20,
      21,
      5,
      5,
      'é🙂2',
    ]);
    expect(doc.toJSON()).toEqual(before);
    expect(doc.version().encode()).toEqual(revision);
  });

  it('does not accidentally make a self-referential scratch SUM or share scratch cells between formulas', () => {
    const doc = document();
    writeSpreadsheetCells(doc, { A1: { value: '7' }, B1: { value: '11' } });
    const response = calculateSpreadsheetForAi(
      doc,
      'v',
      {
        action: 'calculate',
        formulas: [
          { formula: '=SUM(1:1)' },
          { formula: '=A1*2' },
          { formula: '=SUM(A1:Z200)' },
        ],
      },
      calculator
    );
    expect(response.results.map((item) => item.value)).toEqual([18, 14, 18]);
  });

  it('preserves quoted text and rejects ambiguous INDIRECT rather than silently using the scratch sheet', () => {
    expect(qualifyScratchFormula('="A1"&A1', 'Inputs')).toBe(
      '="A1"&\'Inputs\'!A1'
    );
    expect(() => qualifyScratchFormula('=INDIRECT("A1")', 'Inputs')).toThrow(
      'INDIRECT'
    );
  });

  it('bounds UTF-8 output without silently shortening original source text', () => {
    const doc = document();
    const value = '🙂'.repeat(4_000);
    writeSpreadsheetCells(
      doc,
      Object.fromEntries(
        Array.from({ length: 8 }, (_, index) => [`A${index + 1}`, { value }])
      )
    );
    const response = readSpreadsheetForAi(
      doc,
      'v',
      { action: 'read' },
      calculator
    );
    expect(response.ranges[0].truncated).toBe(true);
    expect(
      response.ranges[0].cells.every((cell) => cell.source === value)
    ).toBe(true);
    expect(
      new TextEncoder().encode(JSON.stringify(response)).length
    ).toBeLessThan(128 * 1024);
  });

  it('rejects non-spreadsheets, missing sheets, out-of-grid addresses and oversized formula requests', () => {
    const doc = document();
    expect(() =>
      readSpreadsheetForAi(
        doc,
        'v',
        { action: 'read', sheetId: 'Missing' },
        calculator
      )
    ).toThrow('does not exist');
    expect(() =>
      readSpreadsheetForAi(
        doc,
        'v',
        { action: 'read', ranges: ['AA1'] },
        calculator
      )
    ).toThrow('Invalid cell address');
    expect(() =>
      calculateSpreadsheetForAi(
        doc,
        'v',
        {
          action: 'calculate',
          formulas: Array.from({ length: 21 }, () => ({ formula: '=1' })),
        },
        calculator
      )
    ).toThrow('20');
    const markdown = new LoroDoc();
    documents.push(markdown);
    expect(() =>
      readSpreadsheetForAi(markdown, 'v', { action: 'read' }, calculator)
    ).toThrow('native');
  });
});

describe('spreadsheet AI atomic editing', () => {
  it('adds a sheet, sets and formats cells, inserts formulas and fills relative references in a single applicable delta', () => {
    const doc = document();
    const before = doc.toJSON();
    const edit = prepareSpreadsheetEdit(
      doc,
      {
        action: 'edit',
        expectedRevision: 'v',
        operations: [
          { type: 'add_sheet', name: 'Budget' },
          {
            type: 'set_cells',
            sheetId: 'Budget',
            cells: [
              { address: 'A1', value: '10' },
              { address: 'A2', value: '15' },
              { address: 'B1', value: '=A1*2' },
            ],
          },
          {
            type: 'format_cells',
            sheetId: 'Budget',
            range: 'B1:B2',
            style: { bold: true, format: 'currency' },
          },
          {
            type: 'fill_cells',
            sheetId: 'Budget',
            sourceRange: 'B1',
            targetRange: 'B1:B2',
          },
          {
            type: 'resize_columns',
            sheetId: 'Budget',
            columns: [{ column: 'B', width: 160 }],
          },
          { type: 'append_rows', sheetId: 'Budget', count: 50 },
        ],
      },
      calculator,
      999999999999999000n
    );
    expect(doc.toJSON()).toEqual(before);
    doc.import(edit.update);
    const budget = readSpreadsheetWorkbook(doc).find(
      (sheet) => sheet.name === 'Budget'
    );
    expect(budget?.cells.B2).toMatchObject({
      value: '=A2*2',
      bold: true,
      format: 'currency',
    });
    expect(budget?.layout).toMatchObject({
      rowCount: 250,
      columnWidths: { 1: 160 },
    });
    expect(edit.changes).toHaveLength(6);
    expect(edit.sheets[1]).toMatchObject({ name: 'Budget', formulaCells: 2 });
  });

  it('validates the entire batch before exposing any changes', () => {
    const doc = document();
    const version = doc.version().encode();
    expect(() =>
      prepareSpreadsheetEdit(
        doc,
        {
          action: 'edit',
          expectedRevision: 'v',
          operations: [
            {
              type: 'set_cells',
              sheetId: 'sheet1',
              cells: [{ address: 'A1', value: '99' }],
            },
            { type: 'rename_sheet', sheetId: 'sheet1', name: 'bad/name' },
          ],
        },
        calculator
      )
    ).toThrow('Sheet names');
    expect(readSpreadsheetCells(doc)).toEqual({});
    expect(doc.version().encode()).toEqual(version);
  });

  it('supports clear, duplicate, rename and delete and retains reference protections', () => {
    const doc = document();
    writeSpreadsheetCells(doc, {
      A1: { value: '5', bold: true },
      B1: { value: '=A1*2' },
    });
    const edit = prepareSpreadsheetEdit(
      doc,
      {
        action: 'edit',
        expectedRevision: 'v',
        operations: [
          { type: 'duplicate_sheet', sheetId: 'sheet1', name: 'Copy' },
          { type: 'clear_cells', sheetId: 'Copy', range: 'A1:B1' },
          { type: 'rename_sheet', sheetId: 'Copy', name: 'Empty copy' },
        ],
      },
      calculator
    );
    doc.import(edit.update);
    const copy = readSpreadsheetWorkbook(doc).find(
      (sheet) => sheet.name === 'Empty copy'
    );
    expect(copy?.cells.A1).toEqual({ value: '', bold: true });
    const removed = prepareSpreadsheetEdit(
      doc,
      {
        action: 'edit',
        expectedRevision: 'v',
        operations: [{ type: 'delete_sheet', sheetId: 'Empty copy' }],
      },
      calculator
    );
    doc.import(removed.update);
    expect(readSpreadsheetWorkbook(doc)).toHaveLength(1);
    const linked = addSpreadsheetSheet(doc, 'Linked');
    writeSpreadsheetCells(doc, { A1: { value: '=Sheet1!A1' } }, linked);
    expect(() =>
      prepareSpreadsheetEdit(
        doc,
        {
          action: 'edit',
          expectedRevision: 'v',
          operations: [{ type: 'delete_sheet', sheetId: 'sheet1' }],
        },
        calculator
      )
    ).toThrow('referenced');
  });

  it('rejects oversized batches and invalid cells/styles/row counts without silently clamping', () => {
    const doc = document();
    const edit = (
      operations: Parameters<typeof prepareSpreadsheetEdit>[1]['operations']
    ) =>
      prepareSpreadsheetEdit(
        doc,
        { action: 'edit', expectedRevision: 'v', operations },
        calculator
      );
    expect(() =>
      edit([
        {
          type: 'format_cells',
          sheetId: 'sheet1',
          range: 'A1:Z100',
          style: { bold: true },
        },
      ])
    ).toThrow('2,000');
    expect(() =>
      edit([
        {
          type: 'set_cells',
          sheetId: 'sheet1',
          cells: [{ address: 'A201', value: '1' }],
        },
      ])
    ).toThrow('Append rows');
    expect(() =>
      edit([
        {
          type: 'format_cells',
          sheetId: 'sheet1',
          range: 'A1',
          style: { fontSize: 999 },
        },
      ])
    ).toThrow('formatting');
    expect(() =>
      edit([{ type: 'append_rows', sheetId: 'sheet1', count: 900 }])
    ).toThrow('exceeding');
    expect(() =>
      edit([
        {
          type: 'resize_columns',
          sheetId: 'sheet1',
          columns: [{ column: 'A', width: 2 }],
        },
      ])
    ).toThrow('widths');
    expect(readSpreadsheetCells(doc)).toEqual({});
  });
});

it('uses selected-sheet local names in private AI calculations without changing the workbook', () => {
  const doc = document();
  doc.getMap('spreadsheetSheetMetadata').set(
    'sheet1',
    JSON.stringify({
      definedNames: [
        { name: 'Rate', formula: '0.1' },
        { name: 'Rate', formula: '0.25', local: true },
      ],
    })
  );
  doc.commit();
  const before = doc.version().encode();
  const result = calculateSpreadsheetForAi(
    doc,
    'revision',
    { action: 'calculate', formulas: [{ formula: '=Rate*100' }] },
    calculator
  );
  expect(result.results[0]).toMatchObject({ type: 'number', value: 25 });
  expect(doc.version().encode()).toEqual(before);
});

it('extends numeric and financial date series through the AI edit tool, then calculates cross-sheet formulas', () => {
  const doc = document();
  const edit = prepareSpreadsheetEdit(
    doc,
    {
      action: 'edit',
      expectedRevision: 'v',
      operations: [
        { type: 'add_sheet', name: "Owner's budget" },
        {
          type: 'set_cells',
          sheetId: "Owner's budget",
          cells: [
            { address: 'A1', value: '1' },
            { address: 'A2', value: '2' },
            { address: 'B1', value: '2026-01-31' },
            { address: 'B2', value: '2026-02-28' },
            { address: 'C1', value: '=A1*10' },
            { address: 'C2', value: '=A2*10' },
          ],
        },
        {
          type: 'fill_cells',
          sheetId: "Owner's budget",
          sourceRange: 'A1:C2',
          targetRange: 'A1:C4',
        },
        {
          type: 'set_cells',
          sheetId: 'sheet1',
          cells: [{ address: 'A1', value: "=SUM('Owner''s budget'!C1:C4)" }],
        },
      ],
    },
    calculator
  );
  doc.import(edit.update);
  const input = readSpreadsheetWorkbook(doc).find(
    (sheet) => sheet.name === "Owner's budget"
  )!;
  expect(input.cells.A4.value).toBe('4');
  expect(input.cells.B3.value).toBe('2026-03-31');
  expect(input.cells.B4.value).toBe('2026-04-30');
  expect(input.cells.C4.value).toBe('=A4*10');
  const before = doc.version().encode();
  const result = calculateSpreadsheetForAi(
    doc,
    'v',
    {
      action: 'calculate',
      formulas: [
        { formula: "=SUM('Owner''s budget'!C1:C4)" },
        { formula: '=Sheet1!A1' },
      ],
    },
    calculator
  );
  expect(result.results.map((cell) => cell.value)).toEqual([100, 100]);
  expect(doc.version().encode()).toEqual(before);
});
