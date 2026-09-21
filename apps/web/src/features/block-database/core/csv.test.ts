import { describe, expect, it } from 'vitest';
import { encodeDatabaseCsv, parseDatabaseCsv } from './csv';

describe('database CSV files', () => {
  it('preserves quoted values, mentions, leading zeroes and wide integer identifiers', () => {
    expect(
      parseDatabaseCsv(
        '\uFEFFName,Notes,Id\r\n"Doe, Jo","Say hi to @bob\nHe said ""hi""",00123\r\nOther,,9007199254740993'
      )
    ).toEqual({
      columns: ['Name', 'Notes', 'Id'],
      rows: [
        ['Doe, Jo', 'Say hi to @bob\nHe said "hi"', '00123'],
        ['Other', '', '9007199254740993'],
      ],
    });
  });
  it('keeps duplicate and blank header values in distinct columns', () => {
    expect(parseDatabaseCsv('Name,name,,Name 2\na,b,c,d').columns).toEqual([
      'Name',
      'name 2',
      'Column 3',
      'Name 2 2',
    ]);
  });
  it('rejects extra cells and broken quotes instead of dropping data', () => {
    expect(() => parseDatabaseCsv('Name\na,b')).toThrow('Row 2');
    expect(() => parseDatabaseCsv('Name\n"oops')).toThrow(/unterminated/i);
  });
  it('pads missing cells and allows a header-only empty table', () => {
    expect(parseDatabaseCsv('Name,Notes\na').rows).toEqual([['a', '']]);
    expect(parseDatabaseCsv('Name,Notes\n').rows).toEqual([]);
  });
  it('quotes CSV and prevents text from becoming a spreadsheet formula', () => {
    expect(
      encodeDatabaseCsv(
        ['Name', 'Amount'],
        [
          ['=SUM(A1)', -12],
          ['Doe, Jo', null],
        ]
      )
    ).toBe('Name,Amount\n"\'=SUM(A1)",-12\n"Doe, Jo",');
  });
});
