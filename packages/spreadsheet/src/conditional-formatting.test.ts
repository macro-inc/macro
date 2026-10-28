import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@ironcalc/wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createInitializedSpreadsheetCalculator,
  type SpreadsheetCalculator,
} from './calculation';
import { engineRule } from './conditional-formatting';
import type { ConditionalFormat } from './sheet-rules';
import type { SpreadsheetCells } from './spreadsheet-document';

let calculator: SpreadsheetCalculator;

beforeAll(() => {
  initSync({
    module: readFileSync(
      createRequire(import.meta.url).resolve('@ironcalc/wasm/wasm_bg.wasm')
    ),
  });
  calculator = createInitializedSpreadsheetCalculator();
});

function cells(values: Record<string, string>): SpreadsheetCells {
  return Object.fromEntries(
    Object.entries(values).map(([address, value]) => [address, { value }])
  );
}

const sheet = (
  values: Record<string, string>,
  conditionalFormats: ConditionalFormat[]
) => ({
  id: 'sheet',
  name: 'Sheet1',
  rowCount: 200,
  cells: cells(values),
  metadata: { conditionalFormats },
});

describe('conditional formatting', () => {
  it('compares values, text and relative formulas as Excel does', () => {
    const result = calculator.calculateWorkbook([
      sheet({ A1: '5', A2: '15', B1: 'Done', B2: 'Open', C1: '1' }, [
        {
          range: 'A1:A3',
          type: 'cellIs',
          operator: 'greaterThan',
          formulas: ['10'],
          style: { fillColor: '#FFC7CE', textColor: '#9C0006' },
        },
        {
          range: 'B1:B2',
          type: 'cellIs',
          operator: 'equal',
          formulas: ['"done"'],
          style: { bold: true },
        },
        // A Gantt bar: an empty cell painted by a formula.
        {
          range: 'D1:D2',
          type: 'expression',
          formulas: ['$C1=1'],
          style: { fillColor: '#3458B7' },
        },
      ]),
    ]).sheet;
    expect(result.A1.conditional).toBeUndefined();
    expect(result.A2.conditional).toEqual({
      fillColor: '#FFC7CE',
      textColor: '#9C0006',
    });
    expect(result.A3).toBeUndefined();
    expect(result.B1.conditional).toEqual({ bold: true });
    expect(result.B2.conditional).toBeUndefined();
    expect(result.D1).toEqual({
      display: '',
      conditional: { fillColor: '#3458B7' },
    });
    expect(result.D2).toBeUndefined();
  });

  it('colors scales, data bars and icon sets from the range values', () => {
    const result = calculator.calculateWorkbook([
      sheet({ A1: '0', A2: '5', A3: '10' }, [
        {
          range: 'A1:A3',
          type: 'colorScale',
          thresholds: [{ type: 'min' }, { type: 'max' }],
          colors: ['#FFFFFF', '#000000'],
        },
        {
          range: 'A1:A3',
          type: 'dataBar',
          thresholds: [{ type: 'min' }, { type: 'max' }],
          colors: ['#638EC6'],
        },
        {
          range: 'A1:A3',
          type: 'iconSet',
          iconSet: '3Arrows',
          thresholds: [
            { type: 'percent', value: '0' },
            { type: 'percent', value: '33' },
            { type: 'percent', value: '67' },
          ],
        },
      ]),
    ]).sheet;
    expect(result.A1.conditional?.fillColor).toBe('#FFFFFF');
    expect(result.A3.conditional?.fillColor).toBe('#000000');
    expect(result.A3.conditional?.dataBar).toMatchObject({
      value: 1,
      color: '#638EC6',
    });
    expect(result.A1.conditional?.icon?.name).toBe('ArrowDown');
    expect(result.A3.conditional?.icon?.name).toBe('ArrowUp');
  });

  it('updates appearances as edits change which cells match', () => {
    const session = calculator.session();
    try {
      session.load([
        sheet({ A1: '5' }, [
          {
            range: 'A1:A2',
            type: 'cellIs',
            operator: 'greaterThan',
            formulas: ['10'],
            style: { italic: true },
          },
        ]),
      ]);
      expect(session.update({ sheet: { A1: { value: '20' } } })).toEqual({
        sheet: {
          A1: { display: '20', number: 20, conditional: { italic: true } },
        },
      });
      expect(session.update({ sheet: { A1: { value: '1' } } })).toEqual({
        sheet: { A1: { display: '1', number: 1 } },
      });
    } finally {
      session.dispose();
    }
  });

  it('skips rules the engine cannot read', () => {
    expect(
      engineRule({ range: 'A1', type: 'cellIs', operator: 'equal' })
    ).toBeUndefined();
    expect(
      engineRule({
        range: 'A1',
        type: 'iconSet',
        iconSet: 'Unknown',
        thresholds: [],
      })
    ).toBeUndefined();
  });
});
