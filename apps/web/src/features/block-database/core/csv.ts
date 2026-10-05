import type { ResultError } from '@core/util/result';
import type { DatabaseSchemaErrorCode } from '@service-storage/databases';
import { err, ok, type Result } from 'neverthrow';
import Papa from 'papaparse';
import { match } from 'ts-pattern';

export type DatabaseCsv = {
  columns: string[];
  rows: string[][];
};

/** Why a CSV cannot become a table. Rows and columns count from 1. */
export type DatabaseCsvFailure =
  | { kind: 'too-large' }
  /** The parser's own words for a row it could not read. */
  | { kind: 'malformed'; row: number; message: string }
  | { kind: 'no-header' }
  | { kind: 'too-many-columns' }
  | { kind: 'too-many-rows' }
  | { kind: 'long-column-name'; column: number }
  | { kind: 'long-row'; row: number };

// The import limits of `crates/databases/src/domain/service/transfer.rs`
// (and `MAX_NAME_LEN` in `service.rs`), checked here before sending.
const MEBIBYTE = 1024 * 1024;
export const MAX_CSV_BYTES = 16 * MEBIBYTE;
const MAX_CSV_ROWS = 10_000;
const MAX_CSV_COLUMNS = 100;
const MAX_COLUMN_NAME = 200;

/** Keep every CSV value as text: importing must not round numbers or lose zeroes. */
export function parseDatabaseCsv(
  text: string
): Result<DatabaseCsv, DatabaseCsvFailure> {
  if (new TextEncoder().encode(text).byteLength > MAX_CSV_BYTES)
    return err({ kind: 'too-large' });
  const result = Papa.parse<string[]>(text, {
    delimiter: ',',
    dynamicTyping: false,
    skipEmptyLines: true,
  });
  const malformed = result.errors[0];
  if (malformed)
    return err({
      kind: 'malformed',
      row: (malformed.row ?? 0) + 1,
      message: malformed.message,
    });
  const rows = result.data;
  const header = rows.shift();
  if (!header?.some((value) => value.trim())) return err({ kind: 'no-header' });
  if (header.length > MAX_CSV_COLUMNS) return err({ kind: 'too-many-columns' });
  if (rows.length > MAX_CSV_ROWS) return err({ kind: 'too-many-rows' });
  const long = header.findIndex(
    (value) => value.trim().length > MAX_COLUMN_NAME
  );
  if (long >= 0) return err({ kind: 'long-column-name', column: long + 1 });
  const ragged = rows.findIndex((row) => row.length > header.length);
  if (ragged >= 0) return err({ kind: 'long-row', row: ragged + 2 });
  const names = new Set<string>();
  const columns = header.map((value, index) => {
    const base = value.trim() || `Column ${index + 1}`;
    let name = base;
    let suffix = 2;
    while (names.has(name.toLocaleLowerCase())) {
      const ending = ` ${suffix++}`;
      name = `${base.slice(0, MAX_COLUMN_NAME - ending.length)}${ending}`;
    }
    names.add(name.toLocaleLowerCase());
    return name;
  });
  return ok({
    columns,
    rows: rows.map((row) => columns.map((_, column) => row[column] ?? '')),
  });
}

export function databaseCsvMessage(failure: DatabaseCsvFailure): string {
  return match(failure)
    .with(
      { kind: 'too-large' },
      () => `Choose a CSV smaller than ${MAX_CSV_BYTES / MEBIBYTE} MB.`
    )
    .with(
      { kind: 'malformed' },
      ({ row, message }) => `CSV row ${row}: ${message}`
    )
    .with({ kind: 'no-header' }, () => 'The CSV needs a header row.')
    .with(
      { kind: 'too-many-columns' },
      () => `A CSV can contain up to ${MAX_CSV_COLUMNS} columns.`
    )
    .with(
      { kind: 'too-many-rows' },
      () =>
        `A CSV can contain up to ${MAX_CSV_ROWS.toLocaleString('en-US')} rows.`
    )
    .with(
      { kind: 'long-column-name' },
      ({ column }) =>
        `Column ${column} has a name longer than ${MAX_COLUMN_NAME} characters.`
    )
    .with(
      { kind: 'long-row' },
      ({ row }) => `Row ${row} has more values than the header.`
    )
    .exhaustive();
}

/** What the import dialog says when the service refused a CSV. */
export function csvImportMessage(
  errors: readonly ResultError<DatabaseSchemaErrorCode>[]
): string {
  return match(errors[0])
    .with({ code: 'INVALID_SCHEMA' }, ({ message }) => message)
    .with(
      { code: 'NETWORK_ERROR' },
      () => 'The CSV could not be sent. Check your connection and try again.'
    )
    .otherwise(() => 'Could not import the CSV. Please try again.');
}

/** Papa Parse handles quoting, line endings, and formula-safe text exports. */
export function encodeDatabaseCsv(
  columns: string[],
  rows: (string | number | null)[][]
): string {
  return Papa.unparse(
    { fields: columns, data: rows },
    {
      newline: '\n',
      escapeFormulae: /^[\s]*[=+\-@\t\r]/,
    }
  );
}
