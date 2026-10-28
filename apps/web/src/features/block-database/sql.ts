/**
 * The reads views do not cover, as engine SQL: a table's every row, and rows by
 * id. Table names arrive already quoted from `GET /databases/{id}`.
 */

/** The virtual row identity column. */
const ROW_ID_COLUMN = 'row_id';

/** The virtual column holding a row's place in its table. */
const ROW_POSITION_COLUMN = 'row_position';

/** The engine takes no parameters, so a string is inlined, its quotes doubled. */
function stringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function selectAll(tableSqlName: string): string {
  if (!tableSqlName) throw new Error('SQL name must not be empty');
  return `SELECT * FROM ${tableSqlName}`;
}

/** Every row of a table, in the table's order. */
export function tableRowsStatement(tableSqlName: string): string {
  return `${selectAll(tableSqlName)} ORDER BY ${ROW_POSITION_COLUMN}`;
}

/** Rows by id, whether or not a view would show them. */
export function rowsByIdStatement(
  tableSqlName: string,
  rowIds: readonly string[]
): string {
  if (!rowIds.length) throw new Error('No rows to read');
  return `${selectAll(tableSqlName)} WHERE ${ROW_ID_COLUMN} IN (${rowIds.map(stringLiteral).join(', ')})`;
}
