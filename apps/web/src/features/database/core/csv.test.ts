import { err } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { databaseCsvMessage, encodeDatabaseCsv, parseDatabaseCsv } from './csv';

describe('database CSV files', () => {
  it('preserves quoted values, mentions, leading zeroes and wide integer identifiers', () => {
    expect(
      parseDatabaseCsv(
        '﻿Name,Notes,Id\r\n"Doe, Jo","Say hi to @bob\nHe said ""hi""",00123\r\nOther,,9007199254740993'
      )._unsafeUnwrap()
    ).toEqual({
      columns: ['Name', 'Notes', 'Id'],
      rows: [
        ['Doe, Jo', 'Say hi to @bob\nHe said "hi"', '00123'],
        ['Other', '', '9007199254740993'],
      ],
    });
  });
  it('keeps duplicate and blank header values in distinct columns', () => {
    expect(
      parseDatabaseCsv('Name,name,,Name 2\na,b,c,d')._unsafeUnwrap().columns
    ).toEqual(['Name', 'name 2', 'Column 3', 'Name 2 2']);
  });
  it('rejects extra cells and broken quotes instead of dropping data', () => {
    expect(parseDatabaseCsv('Name\na,b')).toEqual(
      err({ kind: 'long-row', row: 2 })
    );
    const broken = parseDatabaseCsv('Name\n"oops')._unsafeUnwrapErr();
    expect(broken).toMatchObject({ kind: 'malformed', row: 2 });
    expect(databaseCsvMessage(broken)).toMatch(/^CSV row 2: .*unterminated/i);
  });
  it('pads missing cells and allows a header-only empty table', () => {
    expect(parseDatabaseCsv('Name,Notes\na')._unsafeUnwrap().rows).toEqual([
      ['a', ''],
    ]);
    expect(parseDatabaseCsv('Name,Notes\n')._unsafeUnwrap().rows).toEqual([]);
  });
  it('refuses a CSV without a header', () => {
    expect(parseDatabaseCsv(',\na,b')).toEqual(err({ kind: 'no-header' }));
    expect(databaseCsvMessage({ kind: 'no-header' })).toBe(
      'The CSV needs a header row.'
    );
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

  it('names the import limits the service holds a CSV to', () => {
    expect(databaseCsvMessage({ kind: 'too-large' })).toBe(
      'Choose a CSV smaller than 16 MB.'
    );
    expect(databaseCsvMessage({ kind: 'too-many-rows' })).toBe(
      'A CSV can contain up to 10,000 rows.'
    );
    expect(databaseCsvMessage({ kind: 'too-many-columns' })).toBe(
      'A CSV can contain up to 100 columns.'
    );
  });
});
