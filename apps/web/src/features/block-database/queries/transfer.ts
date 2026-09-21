import { invalidateDatabase, querySql } from '@queries/storage/databases';
import { storageServiceClient } from '@service-storage/client';
import type {
  DatabaseTableDetail,
  ImportDatabaseTableRequest,
  SqlValue,
} from '@service-storage/databases';
import { encodeDatabaseCsv } from '../core/csv';
import { exportPageStatement } from '../sql';

/** Request IDs survive a transport error; retrying resolves the original import. */
export async function importDatabaseTable(
  databaseId: string,
  request: ImportDatabaseTableRequest
) {
  const result = await storageServiceClient.databases.importTable({
    id: databaseId,
    request,
  });
  if (result.isErr())
    throw Object.assign(
      new Error(
        result.error[0]?.message ?? 'Could not import this CSV. Try again.'
      ),
      { code: result.error[0]?.code }
    );
  // A cache refresh failure must not turn a committed import into a failed one.
  await invalidateDatabase(databaseId);
  return result.value;
}

/** Never silently export a partial query or a mixture of table versions. */
export async function exportDatabaseTableCsv(
  table: DatabaseTableDetail
): Promise<Blob> {
  const rows: SqlValue[][] = [];
  let version: number | undefined;
  const columns = table.columns.filter(
    (column) => column.column.config?.kind !== 'lookup'
  );
  for (let offset = 0; ; offset += 5000) {
    const outcome = await querySql(
      exportPageStatement(table.read_sql_name ?? table.sql_name, offset, 5000)
    );
    if (outcome.truncated_tables.length)
      throw new Error(
        'This table is too large for CSV export. Download SQLite instead.'
      );
    const current = outcome.read_versions[table.table.id];
    if (current === undefined || (version !== undefined && version !== current))
      throw new Error('The table changed during export. Please try again.');
    version = current;
    const result = outcome.results[0];
    if (!result) throw new Error('The table could not be exported.');
    const indexes = columns.map((column) =>
      result.columns.findIndex((field) => field.name === column.sql_name)
    );
    if (indexes.some((index) => index < 0))
      throw new Error(
        'The columns changed. Refresh the database before exporting.'
      );
    rows.push(...result.rows.map((row) => indexes.map((index) => row[index])));
    if (result.rows.length < 5000) break;
  }
  return new Blob(
    [
      encodeDatabaseCsv(
        columns.map(
          (column) =>
            column.column.display_name ??
            column.definition.definition.display_name
        ),
        rows
      ),
    ],
    { type: 'text/csv;charset=utf-8' }
  );
}
