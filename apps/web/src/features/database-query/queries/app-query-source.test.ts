import { DATABASE_MODEL } from '@core/component/AI/constant';
import { databaseSqlSchema } from '@core/database-sql/catalog';
import { readDatabaseSql } from '@queries/database-sql/create-database-sql-query';
import { fetchViewerDatabases } from '@queries/storage/databases';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import { okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { createQueryCapabilities } from './app-query-source';
import { toQuerySchema } from './query-source';

vi.mock('@queries/storage/databases', () => ({
  fetchViewerDatabases: vi.fn(),
}));
vi.mock('@queries/database-sql/create-database-sql-query', () => ({
  readDatabaseSql: vi.fn(),
}));
vi.mock('@service-connection/client', () => ({
  useEntitySubscription: vi.fn(),
}));
vi.mock('@queries/storage/databases-sync', () => ({
  useDatabaseTableChanges: vi.fn(),
}));
vi.mock('@app/features/paywall/ai-usage-limit-handling', () => ({
  handleAiUsageLimitError: vi.fn(),
}));

const databases: DatabaseDetail[] = ['first', 'second'].map((id) => ({
  database: {
    id,
    name: 'CRM',
    owner_id: 'owner',
    created_at: '',
    trashed_at: null,
  },
  grant: 'view',
  tables: [
    {
      table: {
        id: `${id}-contacts`,
        database_id: id,
        name: 'Contacts',
        position: 'a',
        version: 1,
      },
      sql_name: '"CRM"."Contacts"',
      columns: [],
      views: [],
    },
  ],
}));

describe('draft question SQL execution', () => {
  it.each(['first', undefined])(
    'passes the explicit source %s to the SQL engine while keeping the viewer catalog',
    async (databaseId) => {
      vi.mocked(fetchViewerDatabases).mockReturnValue(okAsync(databases));
      vi.mocked(readDatabaseSql).mockReturnValue(
        okAsync({
          catalog: { tables: [] },
          outcome: {
            columns: [{ name: 'Count', kind: 'number' }],
            rows: [[{ type: 'number', value: 3 }]],
            rowIds: [],
            readTables: ['first-contacts'],
            truncated: false,
            insertedRowIds: [],
            changesApplied: 0,
          },
        })
      );
      const capabilities = createQueryCapabilities(() => DATABASE_MODEL);
      const source = toQuerySchema(databases[0]);
      const sql = 'SELECT COUNT(*) AS Count FROM "CRM"."Contacts"';
      const result = await capabilities.read(sql, { databaseId, source });

      expect(result._unsafeUnwrap()).toMatchObject({
        rows: [[{ type: 'number', value: 3 }]],
        source,
      });
      expect(readDatabaseSql).toHaveBeenLastCalledWith({
        schema: databaseSqlSchema(databases),
        sql,
        scope: databaseId,
      });
    }
  );
});
