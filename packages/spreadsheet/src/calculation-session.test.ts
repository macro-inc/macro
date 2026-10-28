import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@ironcalc/wasm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  type CalculationSheet,
  createInitializedSpreadsheetCalculator,
  type SpreadsheetCalculator,
  type WorkbookCalculation,
} from './calculation';
import type { SpreadsheetCell, SpreadsheetCells } from './spreadsheet-document';

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

/** A small deterministic generator, so a failure reproduces exactly. */
function random(seed: number) {
  let state = seed;
  return (limit: number) => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state % limit;
  };
}

const SOURCES = [
  '',
  '7',
  '-2.5',
  'text',
  '2026-01-31',
  '1.5e3',
  '=A1+B2',
  '=SUM(A1:C4)',
  '=Data!A1*2',
  '=IF(A2>3,"big",A2)',
  '=SEQUENCE(3)',
  '=TRANSPOSE(A1:A3)',
  '=A1/0',
  '=B1+1',
  '=TODAY()',
  '=VLOOKUP(A1,Data!A:B,2,FALSE)',
  '=Rate*A3',
  '=Monthly',
];

function cell(
  source: string,
  format?: SpreadsheetCell['format']
): SpreadsheetCell {
  return { value: source, ...(format && { format }) };
}

function apply(
  sheets: CalculationSheet[],
  changes: Record<string, Record<string, SpreadsheetCell | null>>
) {
  for (const sheet of sheets)
    for (const [address, next] of Object.entries(changes[sheet.id] ?? {}))
      if (next) sheet.cells[address] = next;
      else delete sheet.cells[address];
}

function workbook(): CalculationSheet[] {
  const report: SpreadsheetCells = {
    A1: cell('1'),
    A2: cell('4'),
    B2: cell('=A2*3'),
  };
  const data: SpreadsheetCells = {
    A1: cell('1'),
    B1: cell('10'),
    A2: cell('2'),
    B2: cell('20'),
  };
  return [
    {
      id: 'report',
      name: 'Report',
      rowCount: 200,
      cells: report,
      metadata: {
        definedNames: [
          { name: 'Rate', formula: '0.25' },
          { name: 'Monthly', formula: 'Report!$A$1*12' },
        ],
      },
    },
    { id: 'data', name: 'Data', rowCount: 200, cells: data },
  ];
}

it('updates a kept workbook exactly as a full recalculation would', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const next = random(seed);
    const sheets = workbook();
    const session = calculator.session();
    try {
      const current: WorkbookCalculation = structuredClone(
        session.load(structuredClone(sheets), { includeTypes: true })
      );
      for (let step = 0; step < 25; step++) {
        const changes: Record<
          string,
          Record<string, SpreadsheetCell | null>
        > = {};
        for (let edit = 0; edit <= next(3); edit++) {
          const sheet = sheets[next(sheets.length)];
          const address = `${'ABC'[next(3)]}${1 + next(4)}`;
          const source = SOURCES[next(SOURCES.length)];
          changes[sheet.id] ??= {};
          changes[sheet.id][address] = source
            ? cell(source, next(6) === 0 ? 'percent' : undefined)
            : null;
        }
        apply(sheets, changes);
        const delta = session.update(structuredClone(changes), {
          includeTypes: true,
        });
        for (const [id, values] of Object.entries(delta)) {
          current[id] ??= {};
          for (const [address, value] of Object.entries(values))
            if (value) current[id][address] = value;
            else delete current[id][address];
        }
        const fresh = calculator.calculateWorkbook(structuredClone(sheets), {
          includeTypes: true,
        });
        expect(
          current,
          `seed ${seed}, step ${step}: ${JSON.stringify(changes)}`
        ).toEqual(fresh);
      }
    } finally {
      session.dispose();
    }
  }
});

it('recovers from a failed update by reloading', () => {
  const session = calculator.session();
  try {
    session.load(workbook());
    expect(() => session.update({ missing: { A1: cell('1') } })).toThrow(
      'Unknown sheet'
    );
    expect(() => session.update({ report: { A1: cell('1') } })).toThrow(
      'No workbook is loaded'
    );
    expect(session.load(workbook()).report.B2.number).toBe(12);
  } finally {
    session.dispose();
  }
});
