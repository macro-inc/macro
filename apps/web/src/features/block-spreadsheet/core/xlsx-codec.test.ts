import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@ironcalc/wasm';
import ExcelJS from 'exceljs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createSpreadsheetCalculator,
  type SpreadsheetCalculator,
} from './calculation';
import {
  type WorkbookFileSheet,
  XLSX_MAX_BYTES,
  XLSX_MAX_EXPANDED_BYTES,
} from './workbook-file-types';
import { inspectXlsxArchive } from './xlsx-archive';
import { decodeXlsx, encodeXlsx } from './xlsx-codec';

// ExcelJS supports range metadata at runtime but omits it from CellFormulaValue.
type RangeFormulaValue = ExcelJS.CellFormulaValue & {
  shareType: 'shared' | 'array';
  ref: string;
};

const xlsxPrototype = Object.getPrototypeOf(
  new ExcelJS.Workbook().xlsx
) as Pick<ExcelJS.Xlsx, 'load'>;

let calculator: SpreadsheetCalculator;
beforeAll(async () => {
  initSync({
    module: readFileSync(
      createRequire(import.meta.url).resolve('@ironcalc/wasm/wasm_bg.wasm')
    ),
  });
  calculator = await createSpreadsheetCalculator();
});
afterAll(() => calculator.dispose());

async function file(workbook: ExcelJS.Workbook) {
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
function simpleSheet(): WorkbookFileSheet {
  return {
    name: 'Sheet 1',
    cells: { A1: { value: '42' } },
    rowCount: 200,
    columnWidths: {},
  };
}

describe('Excel workbook files', () => {
  it('round trips real XLSX with multiple sheets, formula caches, values, styles and widths', async () => {
    const sheets: WorkbookFileSheet[] = [
      {
        name: 'Sheet 1',
        rowCount: 200,
        columnWidths: { 0: 184, 2: 320 },
        cells: {
          A1: {
            value: '42.5',
            format: 'currency',
            decimals: 3,
            italic: true,
            bold: true,
            underline: true,
            strikethrough: true,
            fontFamily: 'mono',
            fontSize: 18,
            fillColor: '#123456',
            textColor: '#ABCDEF',
            horizontalAlign: 'right',
            verticalAlign: 'top',
            wrap: true,
            borderTop: true,
            borderRight: true,
          },
          B1: { value: "=A1+'Sheet 2'!A1" },
          C1: { value: '=literal', format: 'text' },
          D1: { value: "'00123" },
          E1: { value: 'TRUE' },
          F1: { value: '46282', format: 'date' },
          G1: { value: '0.5625', format: 'time' },
        },
        values: { B1: { display: '47.5', number: 47.5 } },
      },
      {
        name: 'Sheet 2',
        rowCount: 200,
        columnWidths: {},
        cells: { A1: { value: '5' } },
      },
    ];
    const encoded = await encodeXlsx({ sheets });
    expect(encoded.warnings).toEqual([]);
    const external = new ExcelJS.Workbook();
    await external.xlsx.load(encoded.bytes.slice().buffer);
    expect(external.worksheets).toHaveLength(2);
    expect(external.worksheets[0].getCell('B1').value).toEqual({
      formula: "A1+'Sheet 2'!A1",
      result: 47.5,
    });
    expect(external.worksheets[0].getCell('C1').value).toBe('=literal');
    expect(external.worksheets[0].getCell('D1').value).toBe('00123');
    expect(external.worksheets[0].getCell('E1').value).toBe(true);
    const decoded = await decodeXlsx(encoded.bytes);
    expect(decoded.warnings).toEqual([]);
    expect(decoded.sheets.map((sheet) => sheet.name)).toEqual([
      'Sheet 1',
      'Sheet 2',
    ]);
    expect(decoded.sheets[0].cells.A1).toEqual(sheets[0].cells.A1);
    expect(decoded.sheets[0].cells.B1.value).toBe("=A1+'Sheet 2'!A1");
    expect(decoded.sheets[0].cells.C1).toEqual(sheets[0].cells.C1);
    expect(decoded.sheets[0].cells.D1.value).toBe("'00123");
    expect(decoded.sheets[0].cells.E1.value).toBe('TRUE');
    expect(decoded.sheets[0].cells.F1).toEqual(sheets[0].cells.F1);
    expect(decoded.sheets[0].cells.G1).toEqual(sheets[0].cells.G1);
    expect(decoded.sheets[0].columnWidths).toEqual({ 0: 184, 2: 320 });
  });

  it('preserves optional percent digits and ungrouped decimal formatting', async () => {
    const sheet = simpleSheet();
    sheet.cells = {
      A1: { value: '0.125', format: 'percent' },
      B1: { value: '1234.5', decimals: 3 },
    };
    const result = await decodeXlsx(
      (await encodeXlsx({ sheets: [sheet] })).bytes
    );
    expect(result.sheets[0].cells).toEqual(sheet.cells);
  });

  it('imports and round trips an independently generated openpyxl workbook', async () => {
    // This fixture was written by Python openpyxl, not the ExcelJS codec under test.
    const bytes = readFileSync(
      createRequire(import.meta.url).resolve(
        './xlsx-fixtures/openpyxl-reference.xlsx'
      )
    );
    const imported = await decodeXlsx(bytes);
    expect(imported.warnings).toEqual([]);
    const overview = imported.sheets[0];
    expect(imported.sheets.map((sheet) => sheet.name)).toEqual([
      'Overview',
      "O'Brien Tax",
    ]);
    expect(overview.cells.A1.value).toBe("='O''Brien Tax'!A1*2");
    expect(overview.cells.A2.value).toBe("'=SUM(A1:A2)");
    expect(overview.cells.A3.value).toBe("'00123");
    expect(overview.cells.A4.value).toBe('TRUE');
    expect(overview.cells.B1).toEqual({
      value: '25.125',
      format: 'currency',
      decimals: 3,
      bold: true,
      italic: true,
      underline: true,
      strikethrough: true,
      fontFamily: 'mono',
      fontSize: 18,
      textColor: '#ABCDEF',
      fillColor: '#123456',
      horizontalAlign: 'center',
      verticalAlign: 'top',
      wrap: true,
      borderTop: true,
      borderLeft: true,
    });
    expect(overview.columnWidths[0]).toBe(173);
    expect(overview.cells.C1.format).toBe('date');
    expect(overview.cells.C2.format).toBe('time');
    const encoded = await encodeXlsx(imported);
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(encoded.bytes.slice().buffer);
    expect(reopened.worksheets[0].getCell('A1').formula).toBe(
      "'O''Brien Tax'!A1*2"
    );
    expect(reopened.worksheets[0].getCell('A2').value).toBe('=SUM(A1:A2)');
    expect(reopened.worksheets[0].getCell('A2').type).toBe(
      ExcelJS.ValueType.String
    );
    expect(reopened.worksheets[0].getCell('A3').value).toBe('00123');
    expect(reopened.worksheets[0].getCell('A4').value).toBe(true);
    expect(reopened.worksheets[0].getColumn(1).width).toBe(24);
  });

  it('imports typed strings, dates and shared formulas without evaluating or flattening formulas', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Inputs');
    sheet.getCell('A1').value = '=not a formula';
    sheet.getCell('A2').value = '00123';
    sheet.getCell('A3').value = 'TRUE';
    const sharedFormula: RangeFormulaValue = {
      formula: 'A2*2',
      result: 246,
      shareType: 'shared',
      ref: 'B1:B2',
    };
    sheet.getCell('B1').value = sharedFormula;
    sheet.getCell('B2').value = { sharedFormula: 'B1', result: 0 };
    sheet.getCell('C1').value = new Date('2026-09-17T00:00:00Z');
    sheet.getCell('C1').numFmt = 'm/d/yyyy';
    const imported = await decodeXlsx(await file(workbook));
    expect(imported.sheets[0].cells.A1.value).toBe("'=not a formula");
    expect(imported.sheets[0].cells.A2.value).toBe("'00123");
    expect(imported.sheets[0].cells.A3.value).toBe("'TRUE");
    expect(imported.sheets[0].cells.B1.value).toBe('=A2*2');
    expect(imported.sheets[0].cells.B2.value).toBe('=A3*2');
    expect(imported.sheets[0].cells.C1.format).toBe('date');
    expect(Number(imported.sheets[0].cells.C1.value)).toBe(
      new Date('2026-09-17T00:00:00Z').getTime() / 86400000 + 25569
    );
  });

  it.each(['SEQUENCE(3,2)', '_xlfn._xlws.SEQUENCE(3,2)'])(
    'recalculates imported %s spills without cached cells blocking them',
    async (formula) => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Spill');
      const arrayFormula: RangeFormulaValue = {
        formula,
        result: 1,
        shareType: 'array',
        ref: 'A1:B3',
      };
      sheet.getCell('A1').value = arrayFormula;
      sheet.getCell('B1').value = 2;
      sheet.getCell('A2').value = 3;
      sheet.getCell('B2').value = 4;
      sheet.getCell('A3').value = 5;
      sheet.getCell('B3').value = 6;
      sheet.getCell('B2').font = { bold: true };
      sheet.getCell('B2').numFmt = '$#,##0.00';
      sheet.getCell('C2').value = 99;
      const imported = await decodeXlsx(await file(workbook));
      const cells = imported.sheets[0].cells;
      expect(cells.A1.value).toBe(`=${formula}`);
      expect(cells.B1).toBeUndefined();
      expect(cells.A2).toBeUndefined();
      expect(cells.B2).toEqual({
        value: '',
        bold: true,
        format: 'currency',
        decimals: 2,
      });
      expect(cells.C2.value).toBe('99');
      expect(imported.warnings.join(' ')).toContain(
        'cached spill values are discarded'
      );
      const result = calculator.calculate(cells);
      expect(result.A1).toEqual({ display: '1', number: 1 });
      expect(result.B2).toEqual({ display: '$4.00', number: 4 });
      expect(result.B3).toEqual({ display: '6', number: 6 });
      expect(result.C2.number).toBe(99);
    }
  );

  it('rejects unsupported legacy array semantics, malformed ranges and conflicting spill contents', async () => {
    for (const [formula, ref, childFormula] of [
      ['SUM(B1:B3*C1:C3)', 'A1:A3', false],
      ['TRANSPOSE(B1:D1)', 'A1:A2', false],
      ['SEQUENCE(3)', 'A1:A1001', false],
      ['SEQUENCE(3)', 'A2:A4', false],
      ['SEQUENCE(3)', 'A1:A3', true],
    ] as const) {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Array');
      const arrayFormula: RangeFormulaValue = {
        formula,
        result: 1,
        shareType: 'array',
        ref,
      };
      sheet.getCell('A1').value = arrayFormula;
      if (childFormula)
        sheet.getCell('A2').value = { formula: '2+2', result: 4 };
      await expect(decodeXlsx(await file(workbook))).rejects.toThrow(
        /array|exceeds the supported/i
      );
    }
  });

  it('preserves formula and numeric types under Excel text formatting without adding rich-text apostrophes', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Types');
    sheet.getCell('A1').value = 12;
    sheet.getCell('A2').value = { formula: 'A1*2', result: 24 };
    sheet.getCell('A3').value = true;
    sheet.getCell('A4').value = { richText: [{ text: 'literal' }] };
    sheet.getCell('A5').value = {
      text: '=literal',
      hyperlink: 'https://macro.com',
    };
    sheet.getCell('A6').value = '=SUM(A1:A2)';
    for (let row = 1; row <= 6; row++) sheet.getCell(`A${row}`).numFmt = '@';
    const imported = await decodeXlsx(await file(workbook));
    const cells = imported.sheets[0].cells;
    expect(cells.A1).toMatchObject({ value: '12' });
    expect(cells.A2).toMatchObject({ value: '=A1*2' });
    expect(cells.A3).toMatchObject({ value: 'TRUE' });
    for (const address of ['A1', 'A2', 'A3'])
      expect(cells[address].format).toBeUndefined();
    expect(cells.A4).toMatchObject({ value: 'literal', format: 'text' });
    expect(cells.A5).toMatchObject({ value: '=literal', format: 'text' });
    expect(cells.A6).toMatchObject({ value: '=SUM(A1:A2)', format: 'text' });
    expect(imported.warnings.join(' ')).toContain(
      'preserve the original value types'
    );
    const calculated = calculator.calculate(cells);
    expect(calculated.A2).toEqual({ display: '24', number: 24 });
    expect(calculated.A4.display).toBe('literal');
    expect(calculated.A5.display).toBe('=literal');
    const external = new ExcelJS.Workbook();
    await external.xlsx.load((await encodeXlsx(imported)).bytes.slice().buffer);
    expect(external.worksheets[0].getCell('A1').type).toBe(
      ExcelJS.ValueType.Number
    );
    expect(external.worksheets[0].getCell('A2').type).toBe(
      ExcelJS.ValueType.Formula
    );
    expect(external.worksheets[0].getCell('A6').type).toBe(
      ExcelJS.ValueType.String
    );
  });

  it('reports unsupported features before returning a neutral workbook', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Original', {
      state: 'hidden',
      views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
    });
    sheet.getCell('A1').value = 'merged';
    sheet.mergeCells('A1:B1');
    sheet.getRow(1).height = 50;
    sheet.getRow(2).hidden = true;
    sheet.getCell('C1').value = {
      text: 'Macro',
      hyperlink: 'https://macro.com',
    };
    sheet.getCell('C2').value = {
      richText: [{ text: 'bold', font: { bold: true } }, { text: ' plain' }],
    };
    sheet.getCell('C3').value = { error: '#DIV/0!' };
    sheet.getCell('C4').note = 'review';
    sheet.getCell('D1').dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"a,b"'],
    };
    workbook.definedNames.add('Original!$A$1', 'Named');
    const entries = unzipSync(await file(workbook));
    entries['xl/charts/chart1.xml'] = strToU8('<chart/>');
    entries['xl/externalLinks/externalLink1.xml'] = strToU8('<externalLink/>');
    const imported = await decodeXlsx(zipSync(entries));
    const warning = imported.warnings.join('\n');
    for (const term of [
      'Charts',
      'External workbook',
      'Named ranges',
      'validation',
      'Hidden sheets',
      'Merged cells',
      'Frozen panes',
      'row heights',
      'Hyperlinks',
      'Rich text',
      'error cells',
      'comments',
    ])
      expect(warning).toContain(term);
    expect(imported.sheets[0].cells.B1).toBeUndefined();
    expect(imported.sheets[0].cells.A1.value).toBe("'merged");
    expect(imported.sheets[0].cells.C2.value).toBe("'bold plain");
  });

  it.each(['rows', 'columns', 'cell', 'sheets'] as const)(
    'rejects %s overflow rather than partially importing',
    async (kind) => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Too large');
      if (kind === 'rows') sheet.getCell('A1001').value = 'keep';
      if (kind === 'columns') sheet.getCell('AA1').value = 'keep';
      if (kind === 'cell') sheet.getCell('A1').value = 'x'.repeat(10001);
      if (kind === 'sheets')
        for (let i = 0; i < 10; i++) workbook.addWorksheet(`More ${i}`);
      await expect(decodeXlsx(await file(workbook))).rejects.toThrow(
        /exceeds|up to 10/
      );
    }
  );

  it('rejects invalid ZIP, encryption, macros, corrupt data and forged expansion sizes', async () => {
    await expect(
      decodeXlsx(new Uint8Array(XLSX_MAX_BYTES + 1))
    ).rejects.toThrow('5 MB');
    await expect(decodeXlsx(strToU8('not a workbook'))).rejects.toThrow(
      'valid'
    );
    const original = (await encodeXlsx({ sheets: [simpleSheet()] })).bytes;
    const entries = unzipSync(original);
    entries['xl/vbaProject.bin'] = new Uint8Array([1]);
    await expect(decodeXlsx(zipSync(entries))).rejects.toThrow('Macro-enabled');
    const central = (bytes: Uint8Array) => {
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength
      );
      for (let i = 0; i < bytes.length - 46; i++)
        if (
          view.getUint32(i, true) === 0x02014b50 &&
          view.getUint32(i + 24, true) > 0
        )
          return { view, offset: i };
      throw new Error('No ZIP entry');
    };
    const encrypted = original.slice();
    const encryptedEntry = central(encrypted);
    encryptedEntry.view.setUint16(encryptedEntry.offset + 8, 1, true);
    expect(() => inspectXlsxArchive(encrypted)).toThrow('unencrypted');
    const tooLarge = original.slice();
    const largeEntry = central(tooLarge);
    largeEntry.view.setUint32(
      largeEntry.offset + 24,
      XLSX_MAX_EXPANDED_BYTES + 1,
      true
    );
    expect(() => inspectXlsxArchive(tooLarge)).toThrow('20 MB');
    const forged = original.slice();
    const forgedEntry = central(forged);
    forgedEntry.view.setUint32(forgedEntry.offset + 24, 1, true);
    expect(() => inspectXlsxArchive(forged)).toThrow('valid');
    const corrupt = original.slice();
    const corruptEntry = central(corrupt);
    corruptEntry.view.setUint32(corruptEntry.offset + 16, 123, true);
    expect(() => inspectXlsxArchive(corrupt)).toThrow('valid');
  });

  it('rejects oversized merge and column ranges before the parser expands them', async () => {
    const original = (await encodeXlsx({ sheets: [simpleSheet()] })).bytes;
    for (const markup of [
      "<mergeCells><mergeCell ref='A1:A1001'/></mergeCells>",
      "<cols><col min='1' max='1000000' width='10'/></cols>",
    ]) {
      const entries = unzipSync(original);
      const path = 'xl/worksheets/sheet1.xml';
      const text = new TextDecoder().decode(entries[path]);
      entries[path] = strToU8(
        text.replace('</worksheet>', `${markup}</worksheet>`)
      );
      await expect(decodeXlsx(zipSync(entries))).rejects.toThrow(
        'exceeds the supported'
      );
    }
  });

  it.each([
    '<cols><col min="1000000000" max="26"/></cols>',
    '<cols><col xmlns:x="urn:test" x:max="26" min="1" max="1000000000"/></cols>',
    '<cols><col min="1" max="&#49;000000000"/></cols>',
    '<mergeCells><mergeCell xmlns:x="urn:test" x:ref="A1:A1" ref="A1:A1000000000"/></mergeCells>',
  ])(
    'rejects disguised allocation ranges before ExcelJS loads: %s',
    async (markup) => {
      const entries = unzipSync(
        (await encodeXlsx({ sheets: [simpleSheet()] })).bytes
      );
      const path = 'xl/worksheets/sheet1.xml';
      entries[path] = strToU8(
        strFromU8(entries[path]).replace(
          '</worksheet>',
          `${markup}</worksheet>`
        )
      );
      // Never execute the dangerous parser path, even if a regression breaks preflight.
      const load = vi
        .spyOn(xlsxPrototype, 'load')
        .mockRejectedValue(new Error('Unexpected ExcelJS load'));
      try {
        await expect(decodeXlsx(zipSync(entries))).rejects.toThrow(
          /Invalid column|exceeds the supported/
        );
        expect(load).not.toHaveBeenCalled();
      } finally {
        load.mockRestore();
      }
    }
  );

  it.each([
    'xl/worksheets/sheet1.xml.backup',
    'extra/xl/worksheets/sheet1.xml',
    'xl//worksheets/sheet1.xml',
    'xl/./worksheets/sheet1.xml',
    'xl/./workbook.xml',
    'xl//workbook.xml',
  ])('rejects ZIP path aliases before ExcelJS loads: %s', async (alias) => {
    const entries = unzipSync(
      (await encodeXlsx({ sheets: [simpleSheet()] })).bytes
    );
    entries[alias] = alias.endsWith('/workbook.xml')
      ? entries['xl/workbook.xml']
      : entries['xl/worksheets/sheet1.xml'];
    const load = vi
      .spyOn(xlsxPrototype, 'load')
      .mockRejectedValue(new Error('Unexpected ExcelJS load'));
    try {
      await expect(decodeXlsx(zipSync(entries))).rejects.toThrow(
        /invalid worksheet path|valid, unencrypted/
      );
      expect(load).not.toHaveBeenCalled();
    } finally {
      load.mockRestore();
    }
  });

  it('removes whole-sheet validations and named ranges before the parser expands them', async () => {
    const entries = unzipSync(
      (await encodeXlsx({ sheets: [simpleSheet()] })).bytes
    );
    const path = 'xl/worksheets/sheet1.xml';
    entries[path] = strToU8(
      strFromU8(entries[path]).replace(
        '</worksheet>',
        '<dataValidations count="1"><dataValidation type="whole" sqref="A1:XFD1048576" prompt="😀 > &amp; &quot;"><formula1>1</formula1></dataValidation></dataValidations></worksheet>'
      )
    );
    entries['xl/workbook.xml'] = strToU8(
      strFromU8(entries['xl/workbook.xml']).replace(
        '</workbook>',
        '<definedNames><definedName name="WholeSheet">\'Sheet 1\'!$A$1:$XFD$1048576</definedName></definedNames></workbook>'
      )
    );
    const xlsx = new ExcelJS.Workbook().xlsx;
    const originalLoad = xlsx.load;
    const load = vi.spyOn(xlsxPrototype, 'load').mockImplementation(function (
      this: typeof xlsx,
      buffer: Parameters<typeof xlsx.load>[0]
    ) {
      const sanitized = unzipSync(new Uint8Array(buffer));
      // These guards throw before any potentially unbounded ExcelJS allocation.
      expect(strFromU8(sanitized[path])).not.toContain('<dataValidations');
      expect(strFromU8(sanitized['xl/workbook.xml'])).not.toContain(
        '<definedNames'
      );
      return originalLoad.call(this, buffer);
    });
    try {
      const result = await decodeXlsx(zipSync(entries));
      expect(result.sheets[0].cells.A1.value).toBe('42');
      expect(result.warnings.join(' ')).toContain('Data validation');
      expect(result.warnings.join(' ')).toContain('Named ranges');
      expect(load).toHaveBeenCalledOnce();
    } finally {
      load.mockRestore();
    }
  });

  it('normalizes sparse sheet IDs before ExcelJS allocates its worksheet array', async () => {
    const entries = unzipSync(
      (
        await encodeXlsx({
          sheets: [
            simpleSheet(),
            {
              ...simpleSheet(),
              name: 'Other 😀 &',
              cells: { A1: { value: "='Sheet 1'!A1" } },
            },
          ],
        })
      ).bytes
    );
    entries['xl/workbook.xml'] = strToU8(
      strFromU8(entries['xl/workbook.xml'])
        .replace('sheetId="1"', 'sheetId="4294967294"')
        .replace('sheetId="2"', 'sheetId="2147483647"')
        .replace('Other 😀 &amp;', 'Other 😀 &amp;&#9;&#10;&#13;')
    );
    const xlsx = new ExcelJS.Workbook().xlsx;
    const originalLoad = xlsx.load;
    const load = vi.spyOn(xlsxPrototype, 'load').mockImplementation(function (
      this: typeof xlsx,
      buffer: Parameters<typeof xlsx.load>[0]
    ) {
      const sanitized = unzipSync(new Uint8Array(buffer));
      expect(strFromU8(sanitized['xl/workbook.xml'])).toContain('sheetId="1"');
      expect(strFromU8(sanitized['xl/workbook.xml'])).not.toContain(
        '4294967294'
      );
      expect(strFromU8(sanitized['xl/workbook.xml'])).not.toContain(
        '2147483647'
      );
      return originalLoad.call(this, buffer);
    });
    try {
      const result = await decodeXlsx(zipSync(entries));
      expect(result.sheets[0].name).toBe('Sheet 1');
      expect(result.sheets[0].cells.A1.value).toBe('42');
      expect(result.sheets[1].name).toBe('Other 😀 &\t\n\r');
      expect(result.sheets[1].cells.A1.value).toBe("='Sheet 1'!A1");
    } finally {
      load.mockRestore();
    }
  });

  it('accepts XML comments and quoted delimiters without treating them as cell references', async () => {
    const entries = unzipSync(
      (await encodeXlsx({ sheets: [simpleSheet()] })).bytes
    );
    const path = 'xl/worksheets/sheet1.xml';
    entries[path] = strToU8(
      strFromU8(entries[path]).replace(
        '</worksheet>',
        '<!-- <row r="999999999"/> --><dataValidations/><cols><col min="1" max="&#50;" width="12" custom="max=\'1000000000\' >"/></cols></worksheet>'
      )
    );
    const result = await decodeXlsx(zipSync(entries));
    expect(result.sheets[0].cells.A1.value).toBe('42');
    expect(result.sheets[0].columnWidths[1]).toBe(89);
  });

  it('warns when an Excel round trip cannot preserve extra unused row allocation', async () => {
    const exported = await encodeXlsx({
      sheets: [{ ...simpleSheet(), rowCount: 300 }],
    });
    expect(exported.warnings.join(' ')).toContain('Extra blank rows');
  });

  it('rejects unsupported export names and addresses without producing a partial file', async () => {
    await expect(
      encodeXlsx({ sheets: [simpleSheet(), simpleSheet()] })
    ).rejects.toThrow('names must be unique');
    await expect(
      encodeXlsx({ sheets: [{ ...simpleSheet(), name: 'invalid/name' }] })
    ).rejects.toThrow('names must be unique');
    await expect(
      encodeXlsx({
        sheets: [{ ...simpleSheet(), cells: { AA1: { value: 'outside' } } }],
      })
    ).rejects.toThrow('Unsupported cell');
  });
});
