import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@ironcalc/wasm';
import { createInitializedSpreadsheetCalculator } from '@macro-inc/spreadsheet/calculation';
import {
  importSpreadsheetSheets,
  readSpreadsheetWorkbook,
} from '@macro-inc/spreadsheet/workbook-document';
import ExcelJS from 'exceljs';
import { LoroDoc } from 'loro-crdt';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeXlsx, encodeXlsx } from './xlsx-codec';

/**
 * An uploaded legacy `.xls` is upgraded to `.xlsx` by LibreOffice on the
 * server; this is that output for a two-sheet budget. It must import into a
 * native spreadsheet like any Excel-written workbook.
 */
const upgraded = () =>
  new Uint8Array(
    readFileSync(
      createRequire(import.meta.url).resolve(
        './xlsx-fixtures/upgraded-from-xls.xlsx'
      )
    )
  );

beforeAll(() =>
  initSync({
    module: readFileSync(
      createRequire(import.meta.url).resolve('@ironcalc/wasm/wasm_bg.wasm')
    ),
  })
);

describe('workbook upgraded from a legacy .xls', () => {
  it('imports both sheets with their cells and formulas', async () => {
    const imported = await decodeXlsx(upgraded());

    expect(imported.sheets.map((sheet) => sheet.name)).toEqual([
      'Budget',
      'Notes',
    ]);
    const [budget, notes] = imported.sheets;
    expect(budget.cells.A1.value).toBe('Month');
    // Stored as text in the .xls, so it stays text rather than becoming a date.
    expect(budget.cells.A2.value).toBe("'2026-01");
    expect(budget.cells.B2.value).toBe('1050');
    expect(budget.cells.D2.value).toBe('=B2-C2');
    expect(budget.cells.D13.value).toBe('=B13-C13');
    expect(budget.cells.A15.value).toBe('Total');
    expect(budget.cells.B15.value).toBe('=SUM(B2:B13)');
    expect(budget.cells.D15.value).toBe('=SUM(D2:D13)');
    expect(budget.cells.F1.value).toBe('Merged header');
    expect(notes.cells.B1.value).toBe('Finance');
    expect(notes.cells.B2.value).toBe('=Budget!D15/Budget!B15');
  });

  it('keeps header styles, number formats and the merged header', async () => {
    const imported = await decodeXlsx(upgraded());
    const budget = imported.sheets[0];

    expect(budget.cells.A1).toMatchObject({
      bold: true,
      fillColor: '#DDEBF7',
    });
    // `#,##0.00` imports as Macro's thousands-separated number format.
    expect(budget.cells.B15).toMatchObject({ format: 'number', decimals: 2 });
    expect(budget.metadata?.merges).toEqual(['F1:H1']);
    expect(imported.warnings).toEqual([
      'Merged ranges are shown as individual cells in Macro and restored on Excel export when their covered cells remain empty.',
    ]);
  });

  it('calculates the same results after native save and reopen', async () => {
    const imported = await decodeXlsx(upgraded());
    const doc = new LoroDoc();
    const reopened = new LoroDoc();
    const engine = createInitializedSpreadsheetCalculator();
    try {
      importSpreadsheetSheets(doc, imported.sheets, true);
      reopened.import(doc.export({ mode: 'snapshot' }));
      const sheets = readSpreadsheetWorkbook(reopened);
      const results = engine.calculateWorkbook(
        sheets.map((sheet) => ({ ...sheet, rowCount: sheet.layout.rowCount })),
        { includeTypes: true }
      );

      const budget = results[sheets[0].id];
      // Revenue 1000 + 50i and cost 600 + 20i for months 1..12.
      expect(budget.B15.number).toBe(15_900);
      expect(budget.C15.number).toBe(8_760);
      expect(budget.D15.number).toBe(7_140);
      expect(budget.D2.number).toBe(430);
      expect(budget.B15.display).toBe('15,900.00');
      expect(results[sheets[1].id].B2.number).toBeCloseTo(7_140 / 15_900, 12);
      for (const values of Object.values(results)) {
        expect(
          Object.entries(values).filter(([, value]) => value.error)
        ).toEqual([]);
      }
    } finally {
      engine.dispose();
    }
  });

  it('exports back to an .xlsx Excel reads with the same formulas', async () => {
    const imported = await decodeXlsx(upgraded());

    const exported = await encodeXlsx({ sheets: imported.sheets });

    const external = new ExcelJS.Workbook();
    await external.xlsx.load(exported.bytes.slice().buffer);
    const budget = external.getWorksheet('Budget')!;
    expect(budget.getCell('B15').formula).toBe('SUM(B2:B13)');
    expect(budget.getCell('D2').formula).toBe('B2-C2');
    expect(budget.getCell('F1').isMerged).toBe(true);
    expect(external.getWorksheet('Notes')!.getCell('B2').formula).toBe(
      'Budget!D15/Budget!B15'
    );
  });
});
