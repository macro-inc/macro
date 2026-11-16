import {
  MAX_PEOPLE_BATCH,
  MAX_PEOPLE_SQL_BYTES,
  MAX_PEOPLE_SQL_COLUMNS,
  MAX_PEOPLE_SQL_INPUT_BYTES,
  MAX_PEOPLE_SQL_ROWS,
  type PeopleSqlRequest,
  PeopleSqlRequestSchema,
  type PeopleSqlResult,
  PeopleSqlResultSchema,
} from './generated';

const UTF8 = new TextEncoder();
const invalid = () => new Error('Invalid local people SQL response');

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function boundedArray(value: unknown, limit: number): value is unknown[] {
  return Array.isArray(value) && value.length <= limit;
}

/** Reject oversized input before traversing the generated contract. */
export function isPeopleSqlRequest(value: unknown): value is PeopleSqlRequest {
  if (!object(value) || !object(value.input)) return false;
  const input = value.input;
  if (input.kind === 'identities') {
    if (
      !boundedArray(input.ids, MAX_PEOPLE_BATCH) ||
      !input.ids.every(
        (id) =>
          typeof id === 'string' &&
          id.length <= 1024 &&
          UTF8.encode(id).length <= 1024
      )
    )
      return false;
  } else if (input.kind === 'statement') {
    if (
      typeof input.sql !== 'string' ||
      input.sql.length > MAX_PEOPLE_SQL_INPUT_BYTES ||
      UTF8.encode(input.sql).length > MAX_PEOPLE_SQL_INPUT_BYTES
    )
      return false;
  } else return false;
  const parsed = PeopleSqlRequestSchema.safeParse(value);
  return (
    parsed.success &&
    parsed.data.scope.identity.length > 0 &&
    UTF8.encode(parsed.data.scope.identity).length <= 1024
  );
}

function textBytes(value: unknown, limit: number): number {
  if (typeof value !== 'string' || value.length > limit) throw invalid();
  const bytes = UTF8.encode(value).length;
  if (bytes > limit) throw invalid();
  return bytes;
}

/** People SQL has only scalar text, one identity, row ids and counts. */
function scalarBytes(cell: unknown): number {
  if (cell === null) return 0;
  if (!object(cell)) throw invalid();
  switch (cell.type) {
    case 'number':
      if (typeof cell.value !== 'number' || !Number.isFinite(cell.value))
        throw invalid();
      return 8;
    case 'entities':
      if (!boundedArray(cell.value, 1) || cell.value.length !== 1)
        throw invalid();
      return textBytes(cell.value[0], 1024);
    case 'row':
      return textBytes(cell.value, 36);
    case 'text':
      return textBytes(cell.value, MAX_PEOPLE_SQL_BYTES);
    default:
      throw invalid();
  }
}

function preflightRows(rows: unknown[], columns: unknown[]): void {
  let bytes = 0;
  for (const row of rows) {
    if (!boundedArray(row, columns.length) || row.length !== columns.length)
      throw invalid();
    for (const cell of row) {
      bytes += scalarBytes(cell);
      if (bytes > MAX_PEOPLE_SQL_BYTES) throw invalid();
    }
  }
  let labels = 0;
  for (const column of columns) {
    if (!object(column)) throw invalid();
    labels += textBytes(column.name, MAX_PEOPLE_SQL_INPUT_BYTES);
    if (labels > MAX_PEOPLE_SQL_INPUT_BYTES) throw invalid();
    if (column.column != null) textBytes(column.column, 36);
    if (column.table != null) textBytes(column.table, 36);
  }
}

function preflightMetadata(
  outcome: Record<string, unknown>,
  rowCount: number
): void {
  if (!boundedArray(outcome.rowIds, rowCount)) throw invalid();
  if (outcome.rowIds.length !== 0 && outcome.rowIds.length !== rowCount)
    throw invalid();
  for (const id of outcome.rowIds) textBytes(id, 36);
  if (!boundedArray(outcome.readTables, 1) || outcome.readTables.length !== 1)
    throw invalid();
  textBytes(outcome.readTables[0], 36);
  if (
    !boundedArray(outcome.insertedRowIds, 0) ||
    outcome.changesApplied !== 0 ||
    outcome.alteredColumn != null
  )
    throw invalid();
}

/** Bound allocations before the generated schema validates the complete wire shape. */
export function parsePeopleSqlResult(value: unknown): PeopleSqlResult {
  if (object(value) && value.kind === 'result') {
    if (!object(value.outcome)) throw invalid();
    const outcome = value.outcome;
    if (
      !boundedArray(outcome.rows, MAX_PEOPLE_SQL_ROWS) ||
      !boundedArray(outcome.columns, MAX_PEOPLE_SQL_COLUMNS) ||
      outcome.columns.length === 0
    )
      throw invalid();
    preflightMetadata(outcome, outcome.rows.length);
    preflightRows(outcome.rows, outcome.columns);
  }
  const parsed = PeopleSqlResultSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  return parsed.data;
}
