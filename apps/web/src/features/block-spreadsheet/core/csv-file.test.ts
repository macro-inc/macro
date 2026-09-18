import { describe, expect, it } from 'vitest';
import { encodeCsv } from './csv-export';
import { csvImportEdits } from './sheet-operations';
import { decodeCsv, isUploadedWorkbook } from './uploaded-workbook';

describe('uploaded Excel/CSV detection', () => {
  it.each(['xlsx', 'XLSX', 'csv', 'CSV'])('recognizes %s', (type) =>
    expect(isUploadedWorkbook(type)).toBe(true)
  );
  it.each(['xls', 'xlsm', 'pdf', 'spreadsheet', '', null, undefined])(
    'rejects %s',
    (type) => expect(isUploadedWorkbook(type)).toBe(false)
  );
});
describe('CSV file import and export', () => {
  it('reads BOM, CRLF, embedded newlines, escaped quotes, Unicode, empty and trailing fields', () => {
    const { cells } = decodeCsv(
      '\uFEFFAccount,Amount,Note,Empty\r\n00123,-1234.56789,"First line\nSecond, ""quoted"" €",\r\n'
    ).sheets[0];
    expect(cells).toEqual({
      A1: { value: "'Account" },
      B1: { value: "'Amount" },
      C1: { value: "'Note" },
      D1: { value: "'Empty" },
      A2: { value: "'00123" },
      B2: { value: '-1234.56789' },
      C2: { value: '\'First line\nSecond, "quoted" €' },
    });
  });
  it('preserves 16+ digit identifiers and protects formula-looking values', () => {
    const { cells } = decodeCsv(
      '1234567890123456,0,0.125,1e3,=SUM(A1:A2),@SUM(A1),+cmd,-12,001,TRUE'
    ).sheets[0];
    expect(Object.values(cells).map((cell) => cell.value)).toEqual([
      "'1234567890123456",
      '0',
      '0.125',
      '1e3',
      "'=SUM(A1:A2)",
      "'@SUM(A1)",
      "'+cmd",
      '-12',
      "'001",
      "'TRUE",
    ]);
  });
  it('exports unrounded numbers and quotes multiline/comma/quote values; external formulas stay inert', () => {
    const csv = encodeCsv(
      {
        A1: { value: '=1/3' },
        B1: { value: '\'two, "words"\nnext' },
        C1: { value: "'=1+1" },
        A2: { value: '-42' },
      },
      {
        A1: { display: '$0.33', number: 1 / 3 },
        B1: { display: 'two, "words"\nnext' },
        C1: { display: '=1+1' },
        A2: { display: '($42.00)', number: -42 },
      }
    );
    expect(csv).toBe('0.3333333333333333,"two, ""words""\nnext",\'=1+1\n-42,,');
    const parsed = decodeCsv(csv).sheets[0].cells;
    expect(parsed.B1.value).toBe('\'two, "words"\nnext');
    expect(parsed.C1.value).toBe("''=1+1");
    expect(parsed.A2.value).toBe('-42');
  });
  it('uses the same safe interpretation when importing into an existing selection', () => {
    const result = csvImportEdits('00123,=1+1\n42,0.125', {
      anchor: { row: 2, column: 1 },
      focus: { row: 2, column: 1 },
    });
    expect(result.edits).toEqual({
      B3: { value: "'00123" },
      C3: { value: "'=1+1" },
      B4: { value: '42' },
      C4: { value: '0.125' },
    });
  });
  it.each([
    '',
    '"unterminated',
    'a'.repeat(10001),
    'x\n'.repeat(1001),
    Array(27).fill('x').join(','),
  ])('rejects invalid or oversized input atomically', (text) =>
    expect(() => decodeCsv(text)).toThrow()
  );
});
