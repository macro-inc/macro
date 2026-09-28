import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@ironcalc/wasm';
import { LoroDoc } from 'loro-crdt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareSpreadsheetEdit, readSpreadsheetForAi } from './ai-workbook';
import {
  createInitializedSpreadsheetCalculator,
  type SpreadsheetCalculator,
} from './calculation';
import {
  readSpreadsheetCells,
  writeSpreadsheetCells,
} from './spreadsheet-document';

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

describe('AI formatting preserves spreadsheet values', () => {
  it('formats an entire column without overwriting a concurrent cell value', () => {
    const doc = new LoroDoc();
    try {
      doc.getMap('spreadsheetMeta').set('formatVersion', 1);
      writeSpreadsheetCells(doc, {
        A1: { value: 'Revenue', bold: true },
        A2: { value: '100' },
      });
      const style = {
        bold: true,
        fontFamily: 'serif' as const,
        fillColor: '#fff2cc',
        textColor: '#434343',
        borderBottom: true,
      };
      const prepared = prepareSpreadsheetEdit(
        doc,
        {
          action: 'edit',
          expectedRevision: 'v',
          operations: [
            {
              type: 'format_cells',
              sheetId: 'sheet1',
              range: 'A1:A200',
              style,
            },
          ],
        },
        calculator
      );
      writeSpreadsheetCells(doc, {
        A2: { value: '125' },
        B2: { value: '=A2*2' },
      });
      doc.import(prepared.update);
      const cells = readSpreadsheetCells(doc);
      expect(cells.A1).toEqual({ value: 'Revenue', ...style });
      expect(cells.A2).toEqual({ value: '125', ...style });
      expect(cells.A200).toEqual({ value: '', ...style });
      expect(cells.B2).toEqual({ value: '=A2*2' });
    } finally {
      doc.free();
    }
  });

  it('keeps API fractional percentages and explicit user-entered percentages numerically equivalent', () => {
    const doc = new LoroDoc();
    try {
      doc.getMap('spreadsheetMeta').set('formatVersion', 1);
      writeSpreadsheetCells(doc, { A1: { value: '5%', format: 'percent' } });
      const prepared = prepareSpreadsheetEdit(
        doc,
        {
          action: 'edit',
          expectedRevision: 'v',
          operations: [
            {
              type: 'set_cells',
              sheetId: 'sheet1',
              cells: [
                { address: 'A2', value: '0.05' },
                { address: 'B1', value: '=SUM(A1:A2)' },
              ],
            },
            {
              type: 'format_cells',
              sheetId: 'sheet1',
              range: 'A1:B2',
              style: { format: 'percent' },
            },
          ],
        },
        calculator
      );
      doc.import(prepared.update);
      const result = readSpreadsheetForAi(
        doc,
        'v',
        { action: 'read', ranges: ['A1:B2'] },
        calculator
      );
      expect(
        result.ranges[0].cells.find((cell) => cell.address === 'A1')
      ).toMatchObject({ source: '5%', value: 0.05, display: '5%' });
      expect(
        result.ranges[0].cells.find((cell) => cell.address === 'A2')
      ).toMatchObject({ source: '0.05', value: 0.05, display: '5%' });
      expect(
        result.ranges[0].cells.find((cell) => cell.address === 'B1')
      ).toMatchObject({ source: '=SUM(A1:A2)', value: 0.1, display: '10%' });
    } finally {
      doc.free();
    }
  });
});
