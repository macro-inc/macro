import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@ironcalc/wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createSpreadsheetCalculator,
  type SpreadsheetCalculator,
} from './calculation';
import {
  SPREADSHEET_DEFAULT_STYLE,
  type SpreadsheetCells,
} from './spreadsheet-document';

function cells(values: Record<string, string>): SpreadsheetCells {
  return Object.fromEntries(
    Object.entries(values).map(([address, value]) => [address, { value }])
  );
}

let calculator: SpreadsheetCalculator;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  initSync({
    module: readFileSync(require.resolve('@ironcalc/wasm/wasm_bg.wasm')),
  });
  calculator = await createSpreadsheetCalculator();
});

describe('spreadsheet calculation with IronCalc', () => {
  it('copies formulas with relative, absolute, mixed, range and quoted references', () => {
    const edits = calculator.copy([
      {
        from: { row: 3, column: 3 },
        to: { row: 4, column: 3 },
        cell: { value: '=B4-C4', bold: true, format: 'currency' },
      },
      {
        from: { row: 3, column: 3 },
        to: { row: 4, column: 4 },
        cell: { value: '=$B$4+B$4+$B4+SUM(B4:C4)+IF(TRUE,0,LEN("B4"))' },
      },
      {
        from: { row: 3, column: 3 },
        to: { row: 2, column: 2 },
        cell: { value: '=A1' },
      },
      {
        from: { row: 0, column: 0 },
        to: { row: 200, column: 0 },
        cell: { value: "'00123" },
      },
    ]);
    expect(edits.D5).toEqual({
      ...SPREADSHEET_DEFAULT_STYLE,
      value: '=B5-C5',
      bold: true,
      format: 'currency',
    });
    expect(edits.E5?.value).toBe(
      '=$B$4+C$4+$B5+SUM(C5:D5)+IF(TRUE,0,LEN("B4"))'
    );
    expect(edits.C3?.value).toContain('#REF!');
    expect(edits.A201?.value).toBe("'00123");
  });

  it('calculates formulas and spill results in appended rows', () => {
    const result = calculator.calculate(
      cells({ A201: '21', B201: '=A201*2', A299: '=SEQUENCE(2)' }),
      300
    );
    expect(result.B201.number).toBe(42);
    expect(result.A300.number).toBe(2);
  });
  it('evaluates dependent formulas, ranges, absolute references and comparisons', () => {
    const result = calculator.calculate(
      cells({
        A1: '100',
        A2: '50',
        B1: '=SUM(A1:A2)',
        B2: '=$A$1*10%',
        C1: '=IF(B1>100, B1-B2, 0)',
        C2: '=AVERAGE(A1:A2)',
      })
    );
    expect(result.B1.number).toBe(150);
    expect(result.B2.number).toBe(10);
    expect(result.C1.number).toBe(140);
    expect(result.C2.number).toBe(75);
  });

  it('keeps formula dependencies independent of source key order', () => {
    const source = cells({ A1: '7', B1: '=A1*2', C1: '=B1+1' });
    expect(
      calculator.calculate(Object.fromEntries(Object.entries(source).reverse()))
    ).toEqual(calculator.calculate(source));
  });

  it('recalculates after edits and removes deleted values', () => {
    expect(
      calculator.calculate(cells({ A1: '5', B1: '=A1*2' })).B1.number
    ).toBe(10);
    expect(
      calculator.calculate(cells({ A1: '9', B1: '=A1*2' })).B1.number
    ).toBe(18);
    const cleared = calculator.calculate(cells({ B1: '=A1*2' }));
    expect(cleared.A1).toBeUndefined();
    expect(cleared.B1.number).toBe(0);
  });

  it('reports circular references and formula errors without losing other cells', () => {
    const result = calculator.calculate(
      cells({
        A1: '=B1',
        B1: '=A1',
        C1: '=1/0',
        D1: '=NO_SUCH_FUNCTION(1)',
        E1: '3',
      })
    );
    expect(result.A1.display).toBe('#CIRC!');
    expect(result.B1.error).toContain('circular');
    expect(result.C1.display).toBe('#DIV/0!');
    expect(result.D1.display).toBe('#NAME?');
    expect(result.E1.number).toBe(3);
  });

  it('propagates errors but evaluates IF lazily', () => {
    const result = calculator.calculate(
      cells({
        A1: '=1/0',
        B1: '=A1+1',
        C1: '=IF(TRUE,42,A1)',
        D1: '=IFERROR(A1,0)',
      })
    );
    expect(result.B1.display).toBe('#DIV/0!');
    expect(result.C1.number).toBe(42);
    expect(result.D1.number).toBe(0);
  });

  it('keeps text, escaped values and booleans distinct from numeric values', () => {
    const result = calculator.calculate(
      cells({ A1: "'00123", A2: 'hello', A3: 'TRUE', A4: '=A2&" world"' })
    );
    expect(result.A1).toEqual({ display: '00123' });
    expect(result.A2).toEqual({ display: 'hello' });
    expect(result.A3).toEqual({ display: 'TRUE' });
    expect(result.A4.display).toBe('hello world');
  });

  it('preserves formulas that intentionally display an empty string', () => {
    expect(calculator.calculate(cells({ A1: '=IF(TRUE,"",1)' })).A1).toEqual({
      display: '',
    });
  });

  it('formats values independently from the full-precision calculation', () => {
    const result = calculator.calculate({
      A1: { value: '=1/3', format: 'number' },
      A2: { value: '=A1*3', format: 'currency' },
      A3: { value: '0.12345', format: 'percent' },
      A4: { value: '=0.1+0.2' },
      A5: { value: '=1/10^20' },
      A6: { value: '$12.34' },
    });
    expect(result.A1.display).toBe('0.33');
    expect(result.A1.number).toBeCloseTo(1 / 3, 14);
    expect(result.A2).toEqual({ display: '$1.00', number: 1 });
    expect(result.A3.display).toBe('12.35%');
    expect(result.A4.number).toBe(0.3);
    expect(result.A5.number).toBe(1e-20);
    expect(result.A6.number).toBe(12.34);
  });

  it('formats decimals, serial dates, times and scientific notation without rounding dependencies', () => {
    const result = calculator.calculate({
      A1: { value: '=1/3', format: 'number', decimals: 4 },
      A2: { value: '=A1*3', format: 'currency', decimals: 0 },
      A3: { value: '0.125', format: 'percent', decimals: 3 },
      A4: { value: '=DATE(2026,9,17)', format: 'date' },
      A5: { value: '=TIME(13,30,15)', format: 'time' },
      A6: { value: '12345', format: 'scientific', decimals: 3 },
      A7: { value: '60', format: 'date' },
      A8: { value: '0', decimals: 2 },
    });
    expect(result.A1.display).toBe('0.3333');
    expect(result.A1.number).toBeCloseTo(1 / 3, 14);
    expect(result.A2).toEqual({ number: 1, display: '$1' });
    expect(result.A3.display).toBe('12.500%');
    expect(result.A4.display).toBe('9/17/2026');
    expect(result.A5.display).toBe('1:30:15 PM');
    expect(result.A6.display).toBe('1.235E4');
    expect(result.A7.display).toBe('2/29/1900');
    expect(result.A8.display).toBe('0.00');
  });

  it('keeps text-formatted values literal during calculation and copying', () => {
    const result = calculator.calculate({
      A1: { value: '=SUM(B1:B2)', format: 'text' },
      A2: { value: '00123', format: 'text' },
      A3: { value: '=RAND()', format: 'text' },
      A4: { value: 'TRUE', format: 'text' },
      A5: { value: '=ISTEXT(A2)' },
    });
    expect(result.A1).toEqual({ display: '=SUM(B1:B2)' });
    expect(result.A2).toEqual({ display: '00123' });
    expect(result.A3).toEqual({ display: '=RAND()' });
    expect(result.A4).toEqual({ display: 'TRUE' });
    expect(result.A5).toEqual({ display: 'TRUE' });
    const copied = calculator.copy([
      {
        from: { row: 0, column: 0 },
        to: { row: 1, column: 0 },
        cell: {
          value: '=B1',
          format: 'text',
          italic: true,
          fontSize: 20,
          fillColor: '#123456',
          borderTop: true,
        },
      },
    ]);
    expect(copied.A2).toEqual({
      ...SPREADSHEET_DEFAULT_STYLE,
      value: '=B1',
      format: 'text',
      italic: true,
      fontSize: 20,
      fillColor: '#123456',
      borderTop: true,
    });
    expect(
      calculator.copy([
        {
          from: { row: 0, column: 0 },
          to: { row: 1, column: 0 },
          cell: { value: '' },
        },
      ]).A2
    ).toEqual({ ...SPREADSHEET_DEFAULT_STYLE, value: '' });
  });

  it('includes array spills and detects blocked spill ranges', () => {
    const result = calculator.calculate(cells({ A1: '=SEQUENCE(2,2)' }));
    expect(result.A1.number).toBe(1);
    expect(result.B1.number).toBe(2);
    expect(result.A2.number).toBe(3);
    expect(result.B2.number).toBe(4);
    expect(
      calculator.calculate(cells({ A1: '=SEQUENCE(2,2)', B2: 'occupied' })).A1
        .display
    ).toBe('#SPILL!');
  });

  it('makes unsupported volatile functions explicit and deterministic', () => {
    const result = calculator.calculate(
      cells({ A1: '=RAND()', A2: '=NOW()', A3: '=A1+1', A4: '="RAND()"' })
    );
    expect(result.A1.display).toBe('#N/A');
    expect(result.A1.error).toContain('same calculation clock');
    expect(result.A2.display).toBe('#N/A');
    expect(result.A3.display).toBe('#N/A');
    expect(result.A4).toEqual({ display: 'RAND()' });
  });

  it('also rejects volatile functions with Excel compatibility prefixes', () => {
    const result = calculator.calculate(
      cells({ A1: '=_xlfn.RAND()', A2: '=_xlfn._xlws.NOW()', A3: '=rand()' })
    );
    expect(result.A1.display).toBe('#N/A');
    expect(result.A2.display).toBe('#N/A');
    expect(result.A3.display).toBe('#N/A');
  });

  it('ignores source addresses outside the supported grid', () => {
    const result = calculator.calculate(
      cells({ A0: '1', A201: '2', AA1: '3' })
    );
    expect(result).toEqual({});
  });

  it('calculates cross-sheet references, quoted names, and spills in one workbook', () => {
    const result = calculator.calculateWorkbook([
      {
        id: 'budget',
        name: 'Budget 2026',
        rowCount: 200,
        cells: cells({ A1: '12', A2: '8', B1: '=SUM(A1:A2)' }),
      },
      {
        id: 'summary',
        name: 'Summary',
        rowCount: 200,
        cells: cells({
          A1: "='Budget 2026'!B1*2",
          B1: '=SEQUENCE(2)',
          C1: '=B2+A1',
        }),
      },
    ]);
    expect(result.budget.B1.number).toBe(20);
    expect(result.summary.A1.number).toBe(40);
    expect(result.summary.B2.number).toBe(2);
    expect(result.summary.C1.number).toBe(42);
  });

  it('resolves reversed default sheet names and circular cross-sheet dependencies', () => {
    const result = calculator.calculateWorkbook([
      {
        id: 'two',
        name: 'Sheet2',
        rowCount: 200,
        cells: cells({ A1: '=Sheet1!A1', B1: '=Sheet1!B1' }),
      },
      {
        id: 'one',
        name: 'Sheet1',
        rowCount: 200,
        cells: cells({ A1: '42', B1: '=Sheet2!B1' }),
      },
    ]);
    expect(result.two.A1.number).toBe(42);
    expect(result.two.B1.display).toBe('#CIRC!');
    expect(result.one.B1.display).toBe('#CIRC!');
  });

  it('translates references with the active workbook names during copying', () => {
    const result = calculator.copy(
      [
        {
          from: { row: 0, column: 0 },
          to: { row: 1, column: 0 },
          cell: { value: "='Budget 2026'!B4+Sheet2!$C$2" },
        },
      ],
      { sheetNames: ['Budget 2026', 'Sheet2'], activeSheet: 1 }
    );
    expect(result.A2?.value).toBe("='Budget 2026'!B5+Sheet2!$C$2");
  });

  it('calculates a full-size ten-sheet workbook with cross-sheet dependencies', () => {
    const sheets = Array.from({ length: 10 }, (_, index) => ({
      id: `sheet-${index}`,
      name: `Sheet${index + 1}`,
      rowCount: 1000,
      cells: cells({
        A1: String(index + 1),
        A1000: index ? `=Sheet${index}!A1000+A1` : '=A1',
      }),
    }));
    const result = calculator.calculateWorkbook(sheets);
    expect(Object.keys(result)).toHaveLength(10);
    expect(result['sheet-9'].A1000.number).toBe(55);
  }, 20_000);

  it('frees a disposed calculator without affecting another editor', async () => {
    const other = await createSpreadsheetCalculator();
    other.dispose();
    other.dispose();
    expect(() => other.calculate({})).toThrow('disposed');
    expect(calculator.calculate(cells({ A1: '42' })).A1.number).toBe(42);
  });
});
