import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@ironcalc/wasm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  type CalculationSheet,
  createInitializedSpreadsheetCalculator,
  type SpreadsheetCalculator,
} from './calculation';
import type { SpreadsheetCell } from './spreadsheet-document';

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

function cell(
  value: string,
  format?: SpreadsheetCell['format']
): SpreadsheetCell {
  return { value, ...(format && { format }) };
}

function sheet(
  cells: CalculationSheet['cells'],
  id = 'sheet1',
  name = 'Plan'
): CalculationSheet {
  return { id, name, rowCount: 50, cells };
}

it('finds the input that makes a formula reach the goal', () => {
  const found = calculator.goalSeek(
    [sheet({ A1: cell('2'), B1: cell('=A1*5'), C1: cell('=A1+B1') })],
    {
      setSheetId: 'sheet1',
      setAddress: 'B1',
      goal: 50,
      changeSheetId: 'sheet1',
      changeAddress: 'A1',
    }
  );
  expect(found).toMatchObject({
    status: 'found',
    value: 10,
    result: 50,
    input: '10',
  });
});

it('seeks across sheets and leaves a loaded workbook unchanged', () => {
  const sheets = [
    sheet({ A1: cell('4') }, 'inputs', 'Inputs'),
    sheet({ B1: cell('=Inputs!A1*3') }, 'summary', 'Summary'),
  ];
  const direct = calculator.goalSeek(sheets, {
    setSheetId: 'summary',
    setAddress: 'B1',
    goal: 30,
    changeSheetId: 'inputs',
    changeAddress: 'A1',
  });
  expect(direct).toMatchObject({ status: 'found', value: 10, result: 30 });

  const session = calculator.session();
  try {
    session.load(structuredClone(sheets), { includeTypes: true });
    const found = session.goalSeek({
      setSheetId: 'summary',
      setAddress: 'B1',
      goal: 30,
      changeSheetId: 'inputs',
      changeAddress: 'A1',
    });
    expect(found).toMatchObject({ status: 'found', value: 10, result: 30 });
    const delta = session.update(
      { inputs: { A2: cell('1') } },
      { includeTypes: true }
    );
    expect(delta.inputs?.A1).toBeUndefined();
    expect(delta.summary?.B1).toBeUndefined();
    expect(delta.inputs?.A2.number).toBe(1);
    const fresh = calculator.calculateWorkbook([
      { ...sheets[0], cells: { ...sheets[0].cells, A2: cell('1') } },
      sheets[1],
    ]);
    expect(fresh.inputs.A1.number).toBe(4);
    expect(fresh.summary.B1.number).toBe(12);
  } finally {
    session.dispose();
  }
});

it('rejects a formula changing cell, a constant set cell, and an independent formula', () => {
  const sheets = [
    sheet({
      A1: cell('4'),
      B1: cell('=A1*3'),
      C1: cell('=1+1'),
      D1: cell('=B1'),
    }),
  ];
  expect(
    calculator.goalSeek(sheets, {
      setSheetId: 'sheet1',
      setAddress: 'A1',
      goal: 10,
      changeSheetId: 'sheet1',
      changeAddress: 'B1',
    })
  ).toMatchObject({ status: 'invalid' });
  expect(
    calculator.goalSeek(sheets, {
      setSheetId: 'sheet1',
      setAddress: 'B1',
      goal: 10,
      changeSheetId: 'sheet1',
      changeAddress: 'B1',
    }).status
  ).toBe('invalid');
  expect(
    calculator.goalSeek(sheets, {
      setSheetId: 'sheet1',
      setAddress: 'C1',
      goal: 10,
      changeSheetId: 'sheet1',
      changeAddress: 'A1',
    })
  ).toMatchObject({
    status: 'invalid',
    message: expect.stringContaining('does not change'),
  });
  const text = calculator.goalSeek(
    [sheet({ A1: cell('hello', 'text'), B1: cell('=A1&"!"') })],
    {
      setSheetId: 'sheet1',
      setAddress: 'B1',
      goal: 1,
      changeSheetId: 'sheet1',
      changeAddress: 'A1',
    }
  );
  expect(text.status).toBe('invalid');
});

it('solves a payment rate', () => {
  const found = calculator.goalSeek(
    [
      sheet({
        A1: cell('0.05'),
        B1: cell('=PMT(A1/12,360,-200000)'),
      }),
    ],
    {
      setSheetId: 'sheet1',
      setAddress: 'B1',
      goal: 1200,
      changeSheetId: 'sheet1',
      changeAddress: 'A1',
    }
  );
  expect(found.status).toBe('found');
  if (found.status === 'invalid') return;
  expect(found.result).toBeCloseTo(1200, 4);
  expect(found.value).toBeGreaterThan(0.05);
  expect(found.value).toBeLessThan(0.1);
});
