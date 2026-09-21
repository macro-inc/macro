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

/**
 * Quote a SQL identifier (table or column name).
 *
 * An empty name would quote to `""`, which SQLite accepts and which would send
 * a statement naming nothing — so it throws instead of building one.
 */
function quoteIdentifier(name: string): string {
  if (!name) throw new Error('SQL identifier must not be empty');
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Render a value as a SQLite literal.
 *
 * `NaN` and the infinities have no SQLite spelling. Writing them as `NULL`
 * would silently clear the cell, so they are rejected rather than translated.
 */
function quoteLiteral(value: SqlValue | boolean | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${value} has no SQL representation`);
    }
    return String(value);
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

/** Insert a row with named values, including a board card's initial group. */
export function insertRowStatement(args: {
  tableSqlName: string;
  values: Record<string, SqlValue>;
}): string {
  const entries = Object.entries(args.values);
  if (!entries.length) return insertEmptyRowStatement(args.tableSqlName);
  if (Object.hasOwn(args.values, ROW_ID_COLUMN))
    throw new Error('Row ids are assigned by the server');
  return (
    `INSERT INTO ${quoteIdentifier(args.tableSqlName)} ` +
    `(${entries.map(([name]) => quoteIdentifier(name)).join(', ')}) ` +
    `VALUES (${entries.map(([, value]) => quoteLiteral(value)).join(', ')})`
  );
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

/** Replace only this row's edges; the caller submits the statements atomically. */
export function replaceRelatedRowsStatement(args: {
  junctionSqlName: string;
  rowId: string;
  relatedIds: readonly string[];
}): string {
  const junction = quoteIdentifier(args.junctionSqlName);
  const rowId = quoteLiteral(args.rowId);
  const remove = `DELETE FROM ${junction} WHERE "row_id" = ${rowId}`;
  const values = [...new Set(args.relatedIds)].map(
    (id) => `(${rowId}, ${quoteLiteral(id)})`
  );
  return values.length
    ? `${remove}; INSERT INTO ${junction} ("row_id", "linked_id") VALUES ${values.join(', ')}`
    : remove;
}

/** Link the row inserted by this same exec; the server resolves its temporary id. */
export function insertRelatedRowsStatement(args: {
  tableSqlName: string;
  junctionSqlName: string;
  relatedIds: readonly string[];
}): string {
  return [...new Set(args.relatedIds)]
    .map(
      (id) =>
        `INSERT INTO ${quoteIdentifier(args.junctionSqlName)} ("row_id", "linked_id") ` +
        `SELECT "row_id", ${quoteLiteral(id)} FROM ${quoteIdentifier(args.tableSqlName)} WHERE "row_id" LIKE 'new:%'`
    )
    .join('; ');
}

/** Stable pagination for exports, independent of the visible filter or row order. */
export function exportPageStatement(
  tableSqlName: string,
  offset: number,
  limit: number
): string {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1
  )
    throw new Error('Invalid export page');
  return `${selectAllStatement(tableSqlName)} ORDER BY ${quoteIdentifier(ROW_ID_COLUMN)} LIMIT ${limit} OFFSET ${offset}`;
}
