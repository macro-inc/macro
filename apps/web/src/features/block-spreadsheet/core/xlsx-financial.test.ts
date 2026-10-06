import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@ironcalc/wasm';
import { createInitializedSpreadsheetCalculator } from '@macro-inc/spreadsheet/calculation';
import {
  importSpreadsheetSheets,
  readSpreadsheetWorkbook,
} from '@macro-inc/spreadsheet/workbook-document';
import ExcelJS from 'exceljs';
import { strFromU8, unzipSync } from 'fflate';
import { LoroDoc } from 'loro-crdt';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type SpreadsheetCells,
  writeSpreadsheetCells,
} from './spreadsheet-document';
import { decodeXlsx, encodeXlsx } from './xlsx-codec';

beforeAll(() =>
  initSync({
    module: readFileSync(
      createRequire(import.meta.url).resolve('@ironcalc/wasm/wasm_bg.wasm')
    ),
  })
);
const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(
      createRequire(import.meta.url).resolve(`./xlsx-fixtures/${name}.xlsx`)
    )
  );

describe('independent financial workbook regression', () => {
  it('imports valid namespace prefixes, absolute package references and table relationships', async () => {
    const imported = await decodeXlsx(fixture('namespaced-table'));
    expect(imported.sheets[0].cells.A2.value).toBe('Sample A');
    expect(imported.sheets[0].cells.B2.value).toBe('42');
    expect(imported.sheets[0].cells.D1.value).toBe('=SUM(B2:B3)');
    const engine = createInitializedSpreadsheetCalculator();
    try {
      expect(engine.calculate(imported.sheets[0].cells).D1.number).toBe(100);
    } finally {
      engine.dispose();
    }
  });

  it('keeps financial formulas, names, precision, number formats and layout through native persistence and XLSX export', async () => {
    const imported = await decodeXlsx(fixture('financial-model'));
    const doc = new LoroDoc();
    const reopened = new LoroDoc();
    const engine = createInitializedSpreadsheetCalculator();
    try {
      importSpreadsheetSheets(doc, imported.sheets, true);
      reopened.import(doc.export({ mode: 'snapshot' }));
      const sheets = readSpreadsheetWorkbook(reopened);
      expect(sheets.map((s) => s.name)).toEqual(['Assumptions', 'DCF model']);
      const results = engine.calculateWorkbook(
        sheets.map((s) => ({ ...s, rowCount: s.layout.rowCount })),
        { includeTypes: true }
      );
      const values = results[sheets[1].id];
      expect(Object.entries(values).filter(([, value]) => value.error)).toEqual(
        []
      );
      expect(values.B4.number).toBeCloseTo(
        100 / 1.1 + 120 / 1.1 ** 2 + 140 / 1.1 ** 3 - 100,
        10
      );
      expect(values.B5.number).toBeCloseTo(0.1, 10);
      expect(values.B8.number).toBeCloseTo(0.1, 8);
      expect(values.B9.number).toBeCloseTo(-1498.876312881892, 7);
      expect(values.B10.number).toBe(360);
      expect(values.C10.number).toBe(36);
      expect(values.B11.number).toBe(260);
      expect(values.B12.number).toBe(120);
      expect(values.B13.number).toBe(0);
      expect(values.B14.number).toBe(25);
      expect(values.C16.number).toBe(1);
      expect(values.A16.display).toBe('0000123');
      expect(values.B18.display).toBe('(1,250,000.13)');
      expect(values.B19.display).toBe('—');
      expect(values.B20.display).toBe('1.3m');
      expect(values.B21.display).toBe('1.3x');
      expect(values.B22.display).toBe('12.50%');
      expect(values.B23.display).toBe('36:00');
      expect(sheets[1].cells.B24.value).toBe('60');
      expect(values.B24.display).toBe('02/29/1900');
      // A value edit and formatting edit must survive export without destroying import metadata.
      writeSpreadsheetCells(
        reopened,
        { B18: { bold: true, value: '-2500000.125' } },
        sheets[1].id
      );
      const edited = readSpreadsheetWorkbook(reopened);
      const exported = await encodeXlsx({
        sheets: edited.map((s) => ({
          ...s,
          ...s.layout,
          values: results[s.id],
        })),
      });
      const external = new ExcelJS.Workbook();
      await external.xlsx.load(exported.bytes.slice().buffer);
      const dcf = external.getWorksheet('DCF model')!;
      expect(dcf.getCell('B4').formula).toBe('NPV(DiscountRate,C3:E3)+B3');
      expect(dcf.getCell('B14').formula).toBe('TaxRate*100');
      expect(dcf.getCell('B18').value).toBe(-2500000.125);
      expect(dcf.getCell('B18').numFmt).toBe('#,##0.00;[Red](#,##0.00);"—"');
      expect(dcf.getCell('B18').font).toMatchObject({
        name: 'Calibri',
        color: { argb: 'FF0000FF' },
        bold: true,
      });
      expect(dcf.getCell('B18').border.bottom).toMatchObject({
        style: 'double',
        color: { argb: 'FF123456' },
      });
      expect(dcf.getCell('A1').isMerged).toBe(true);
      expect(dcf.getRow(1).height).toBe(32);
      expect(dcf.getRow(6).hidden).toBe(true);
      expect(dcf.getColumn('F').hidden).toBe(true);
      expect(dcf.views[0]).toMatchObject({
        state: 'frozen',
        xSplit: 1,
        ySplit: 3,
      });
      expect(dcf.autoFilter).toBe('A2:E3');
      expect(external.getWorksheet('Assumptions')!.state).toBe('hidden');
      const xml = strFromU8(unzipSync(exported.bytes)['xl/workbook.xml']);
      expect(xml).toContain('name="TaxRate" localSheetId="1"');
      const again = await decodeXlsx(exported.bytes);
      for (let index = 0; index < edited.length; index++) {
        expect(again.sheets[index].metadata).toEqual(edited[index].metadata);
        for (const [address, cell] of Object.entries(edited[index].cells)) {
          expect(again.sheets[index].cells[address]).toMatchObject(cell);
        }
      }
    } finally {
      engine.dispose();
      reopened.free();
      doc.free();
    }
  });

  it('does not merge away values added inside an imported merged range', async () => {
    const imported = await decodeXlsx(fixture('financial-model'));
    imported.sheets[1].cells.B1 = { value: '42' };
    const exported = await encodeXlsx(imported);
    expect(exported.warnings.join(' ')).toContain('omitted to preserve values');
    const result = await decodeXlsx(exported.bytes);
    expect(result.sheets[1].cells.B1.value).toBe('42');
    expect(result.sheets[1].metadata?.merges).toBeUndefined();
  });
});

it('preserves 1904 calendar dates without shifting times or elapsed durations', async () => {
  const excel = new ExcelJS.Workbook();
  excel.properties.date1904 = true;
  const sheet = excel.addWorksheet('Dates');
  for (const [address, value, format] of [
    ['A1', 0.5, '[h]:mm'],
    ['A2', 0.5, 'hh:mm:ss'],
    ['A3', 40000, 'mm/dd/yyyy'],
  ] as const) {
    sheet.getCell(address).value = value;
    sheet.getCell(address).numFmt = format;
  }
  sheet.getCell('B1').value = { formula: 'A1*24' };
  const input = await decodeXlsx(
    new Uint8Array(await excel.xlsx.writeBuffer())
  );
  expect(input.sheets[0].cells.A1.value).toBe('0.5');
  expect(input.sheets[0].cells.A2.value).toBe('0.5');
  expect(input.sheets[0].cells.A3.value).toBe('41462');
  const engine = createInitializedSpreadsheetCalculator();
  try {
    const values = engine.calculate(input.sheets[0].cells);
    expect(values.B1.number).toBe(12);
    expect(values.A1.display).toBe('12:00');
    const exported = await encodeXlsx(input);
    expect((await decodeXlsx(exported.bytes)).sheets[0].cells).toEqual(
      input.sheets[0].cells
    );
  } finally {
    engine.dispose();
  }
});

it('preserves stored errors, IFERROR and error propagation through native and Excel round trips', async () => {
  const excel = new ExcelJS.Workbook();
  const sheet = excel.addWorksheet('Errors');
  sheet.getCell('A1').value = { error: '#DIV/0!' };
  sheet.getCell('A2').value = '#DIV/0!';
  sheet.getCell('B1').value = { formula: 'IFERROR(A1,0)' };
  sheet.getCell('C1').value = { formula: 'SUM(A1,1)' };
  const imported = await decodeXlsx(
    new Uint8Array(await excel.xlsx.writeBuffer())
  );
  const doc = new LoroDoc();
  const reopened = new LoroDoc();
  const engine = createInitializedSpreadsheetCalculator();
  try {
    importSpreadsheetSheets(doc, imported.sheets, true);
    reopened.import(doc.export({ mode: 'snapshot' }));
    const native = readSpreadsheetWorkbook(reopened)[0];
    const values = engine.calculate(native.cells);
    expect(values.A1.display).toBe('#DIV/0!');
    expect(values.A1.error).toBeDefined();
    expect(values.A2.error).toBeUndefined();
    expect(values.B1.number).toBe(0);
    expect(values.C1.display).toBe('#DIV/0!');
    const exported = await encodeXlsx({
      sheets: [{ ...native, ...native.layout, values }],
    });
    const external = new ExcelJS.Workbook();
    await external.xlsx.load(exported.bytes.slice().buffer);
    expect(external.worksheets[0].getCell('A1').value).toEqual({
      error: '#DIV/0!',
    });
    expect(external.worksheets[0].getCell('A2').value).toBe('#DIV/0!');
    expect((await decodeXlsx(exported.bytes)).sheets[0].cells).toEqual(
      native.cells
    );
  } finally {
    doc.free();
    reopened.free();
    engine.dispose();
  }
});

it('isolates unsupported display formats and resolves qualified worksheet-local names', () => {
  const engine = createInitializedSpreadsheetCalculator();
  try {
    const result = engine.calculateWorkbook([
      {
        id: 'a',
        name: 'Inputs',
        rowCount: 200,
        cells: { A1: { value: '10' } },
        metadata: {
          definedNames: [{ name: 'Rate', formula: '0.2', local: true }],
        },
      },
      {
        id: 'b',
        name: 'Tax assumptions',
        rowCount: 200,
        cells: { A1: { value: '5' } },
        metadata: {
          definedNames: [
            { name: 'Rate', formula: "'Tax assumptions'!$A$1", local: true },
          ],
        },
      },
      {
        id: 'c',
        name: 'Output',
        rowCount: 200,
        cells: {
          A1: { value: '40000', numberFormat: '[$-411]ge.m.d' },
          B1: { value: '=Inputs!Rate*10' },
          B2: { value: "='Tax assumptions'!Rate*10" },
          B3: { value: '="Inputs!Rate"' },
        },
      },
    ]);
    expect(result.c.A1.number).toBe(40000);
    expect(result.c.A1.warning).toContain('format');
    expect(result.c.B1.number).toBe(2);
    expect(result.c.B2.number).toBe(50);
    expect(result.c.B3.display).toBe('Inputs!Rate');
  } finally {
    engine.dispose();
  }
});

it('looks up whole columns within the grid, quickly and with sorted matches', () => {
  const engine = createInitializedSpreadsheetCalculator();
  try {
    const data: SpreadsheetCells = {};
    for (let row = 1; row <= 500; row++) {
      data[`A${row}`] = { value: String(row) };
      data[`B${row}`] = { value: String(row * 3) };
    }
    const report: SpreadsheetCells = {};
    for (let row = 1; row <= 500; row++)
      report[`A${row}`] = {
        value: `=VLOOKUP(${row},Data!A:B,2,FALSE)+MATCH(${row},Data!$A:$A,1)+COUNTA(Data!A:A)`,
      };
    const started = performance.now();
    const result = engine.calculateWorkbook([
      { id: 'data', name: 'Data', rowCount: 500, cells: data },
      { id: 'report', name: 'Report', rowCount: 500, cells: report },
    ]);
    // Scanning 1,048,576 rows per lookup took over a minute here.
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(result.report.A7.number).toBe(7 * 3 + 7 + 500);
    expect(result.report.A500.number).toBe(500 * 3 + 500 + 500);
  } finally {
    engine.dispose();
  }
});

it('calculates names defined by formulas, as Excel loan templates use them', () => {
  const engine = createInitializedSpreadsheetCalculator();
  try {
    const result = engine.calculateWorkbook([
      {
        id: 'loan',
        name: 'Loan calculator',
        rowCount: 200,
        cells: {
          D3: { value: '10000' },
          D4: { value: '0.06' },
          D5: { value: '2' },
          D6: { value: '45000' },
          D8: { value: '=IFERROR(IF(Values_Entered,Monthly_Payment,""),"")' },
          D9: { value: '=Loan_Years*12' },
          B14: { value: '=Payment_Number' },
          C14: { value: '=ROUND(Ending_Balance,2)' },
          B15: { value: '=Payment_Number' },
          E9: { value: '=Left_Neighbor' },
          A1: { value: '=Left_Neighbor' },
          E15: { value: '=Loops' },
          E16: { value: '=Deleted' },
          E17: { value: "='Loan calculator'!Header_Row" },
        },
        metadata: {
          definedNames: [
            { name: 'Loan_Amount', formula: "'Loan calculator'!$D$3" },
            { name: 'Interest_Rate', formula: "'Loan calculator'!$D$4" },
            { name: 'Loan_Years', formula: "'Loan calculator'!$D$5" },
            { name: 'Loan_Start', formula: "'Loan calculator'!$D$6" },
            { name: 'Number_of_Payments', formula: "'Loan calculator'!$D$9" },
            {
              name: 'Values_Entered',
              formula:
                'IF(Loan_Amount*Interest_Rate*Loan_Years*Loan_Start>0,1,0)',
            },
            {
              name: 'Monthly_Payment',
              formula: '-PMT(Interest_Rate/12,Number_of_Payments,Loan_Amount)',
            },
            { name: 'Header_Row', formula: "ROW('Loan calculator'!$13:$13)" },
            { name: 'Payment_Number', formula: 'ROW()-Header_Row' },
            {
              name: 'Ending_Balance',
              formula:
                '-FV(Interest_Rate/12,Payment_Number,-Monthly_Payment,Loan_Amount)',
            },
            // Relative to A1: one column to the left of the using cell.
            { name: 'Left_Neighbor', formula: "'Loan calculator'!XFD1" },
            { name: 'Loops', formula: 'Loops+1' },
            { name: 'Deleted', formula: "'Loan calculator'!#REF!" },
          ],
        },
      },
    ]);
    const values = result.loan;
    expect(values.D8.number).toBeCloseTo(443.206, 3);
    expect(values.B14.number).toBe(1);
    expect(values.B15.number).toBe(2);
    expect(values.C14.number).toBeCloseTo(9606.79, 2);
    expect(values.E9.number).toBe(24);
    // XFD1 is A1's left neighbor after wrapping, and it is empty.
    expect(values.A1.number).toBe(0);
    expect(values.E15.display).toBe('#N/A');
    expect(values.E15.error).toContain('refers to itself');
    expect(values.E16.display).toBe('#REF!');
    expect(values.E17.number).toBe(13);
  } finally {
    engine.dispose();
  }
});

it('never reads a column reference as a name that shares its letters', () => {
  const engine = createInitializedSpreadsheetCalculator();
  try {
    const result = engine.calculateWorkbook([
      {
        id: 'data',
        name: 'Data',
        rowCount: 200,
        cells: { B2: { value: '4' }, B3: { value: '6' }, AB1: { value: '1' } },
        metadata: {
          // Converted Lotus workbooks often carry names like these.
          definedNames: [
            { name: 'B', formula: '{#N/A,FALSE,"CGBR95C"}' },
            { name: 'A', formula: '#REF!' },
          ],
        },
      },
      {
        id: 'report',
        name: 'Report',
        rowCount: 200,
        cells: {
          A1: { value: '=Data!B$2*2' },
          A2: { value: '=SUM(Data!B:B)' },
          A3: { value: '=Data!AB$1+1' },
        },
      },
    ]);
    expect(result.report.A1.number).toBe(8);
    expect(result.report.A2.number).toBe(10);
    expect(result.report.A3.number).toBe(2);
  } finally {
    engine.dispose();
  }
});

it('shows a HYPERLINK as its friendly name or link text', () => {
  const engine = createInitializedSpreadsheetCalculator();
  try {
    const values = engine.calculate({
      A1: { value: 'Quote' },
      B1: { value: '=HYPERLINK("https://example.com/q1",A1&" 1")' },
      B2: { value: '=HYPERLINK("https://example.com")' },
      B3: {
        value: '=LEN(HYPERLINK("https://example.com",HYPERLINK("x","ab")))',
      },
    });
    expect(values.B1.display).toBe('Quote 1');
    expect(values.B2.display).toBe('https://example.com');
    expect(values.B3.number).toBe(2);
  } finally {
    engine.dispose();
  }
});

it.each(['#SPILL!', '#CALC!'])(
  'imports stored %s errors, which older engines cannot represent, as text with a warning',
  async (error) => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Errors').getCell('A1').value = { error: '#N/A' };
    const { unzipSync, zipSync, strToU8 } = await import('fflate');
    const files = unzipSync(new Uint8Array(await workbook.xlsx.writeBuffer()));
    files['xl/worksheets/sheet1.xml'] = strToU8(
      strFromU8(files['xl/worksheets/sheet1.xml']).replace('#N/A', error)
    );
    const imported = await decodeXlsx(zipSync(files));
    expect(imported.sheets[0].cells.A1.value).toBe(`'${error}`);
    expect(imported.warnings.join(' ')).toContain('imported as text');
  }
);
