/**
 * SQL text builders for the database grid.
 *
 * `POST /databases/exec` takes SQL as one string and nothing else — there is
 * no parameter array — so every value is inlined as a SQLite literal here.
 * Identifiers and literals both go through the quoting helpers below; nothing
 * in this module should ever concatenate a raw string into a statement.
 */
import type { SqlValue } from '@service-storage/databases';

/** The server-assigned row identity column present on every user table. */
export const ROW_ID_COLUMN = 'row_id';

/** Quote a SQL identifier (table or column name). */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Render a value as a SQLite literal. */
export function quoteLiteral(value: SqlValue | boolean | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  return `'${value.replaceAll("'", "''")}'`;
}

/** `SELECT * FROM <table>` — the grid's read. */
export function selectAllStatement(tableSqlName: string): string {
  return `SELECT * FROM ${quoteIdentifier(tableSqlName)}`;
}

/** Update one cell of one row. */
export function updateCellStatement(args: {
  tableSqlName: string;
  columnSqlName: string;
  rowId: string;
  value: SqlValue;
}): string {
  return (
    `UPDATE ${quoteIdentifier(args.tableSqlName)} ` +
    `SET ${quoteIdentifier(args.columnSqlName)} = ${quoteLiteral(args.value)} ` +
    `WHERE ${quoteIdentifier(ROW_ID_COLUMN)} = ${quoteLiteral(args.rowId)}`
  );
}

/**
 * Append an empty row. Row ids are minted by the server, so no `row_id` is
 * supplied; `DEFAULT VALUES` is the only spelling that inserts no columns.
 */
export function insertEmptyRowStatement(tableSqlName: string): string {
  return `INSERT INTO ${quoteIdentifier(tableSqlName)} DEFAULT VALUES`;
}

/** Remove one row from a table (membership only — entities are untouched). */
export function deleteRowStatement(args: {
  tableSqlName: string;
  rowId: string;
}): string {
  return (
    `DELETE FROM ${quoteIdentifier(args.tableSqlName)} ` +
    `WHERE ${quoteIdentifier(ROW_ID_COLUMN)} = ${quoteLiteral(args.rowId)}`
  );
}
