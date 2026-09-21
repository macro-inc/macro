import { databasesKeys } from '@queries/storage/keys';
import type {
  DatabaseColumnDetail,
  DatabaseDetail,
  ExecOutcome,
} from '@service-storage/databases';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import type { DatabaseRelationSource } from '../context/relation-source';
import { createDatabaseRelations } from './database-relations';

const transport = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { databases: transport },
}));
const nameColumn: DatabaseColumnDetail = {
  column: {
    id: 'name',
    table_id: 'customers',
    property_definition_id: 'name-definition',
    position: 'a',
    config: null,
  },
  sql_name: 'name',
  writable: true,
  definition: {
    definition: {
      id: 'name-definition',
      owner: { scope: 'database', database_id: 'db' },
      display_name: 'Name',
      data_type: 'STRING',
      is_multi_select: false,
      specific_entity_type: null,
      created_at: '',
      updated_at: '',
      is_system: false,
      is_metadata: false,
    },
    property_options: [],
  },
};
const detail: DatabaseDetail = {
  database: {
    id: 'db',
    name: 'Support',
    owner_id: 'owner',
    created_at: '',
    trashed_at: null,
  },
  grant: 'owner',
  tables: [
    {
      table: {
        id: 'customers',
        database_id: 'db',
        name: 'Customers',
        position: 'a',
        version: 1,
      },
      sql_name: 'customers',
      read_sql_name: '_macro_table_customers',
      columns: [nameColumn],
    },
  ],
};
const outcome = (name: string): ExecOutcome => ({
  results: [
    {
      columns: [
        { name: 'row_id', entity_type: null, origin: null },
        { name: 'name', entity_type: null, origin: null },
      ],
      rows: [['customer-1', name]],
    },
  ],
  changes_applied: 0,
  inserted_row_ids: [],
  new_versions: {},
  read_tables: ['customers'],
  read_versions: { customers: 1 },
  truncated_tables: [],
});
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});

it('shares one target-table read across multiple relation columns and reacts to customer renames in the cache', async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  transport.get.mockResolvedValue(ok(detail));
  const exec = vi.fn(async () => outcome('Acme'));
  let first!: DatabaseRelationSource;
  let second!: DatabaseRelationSource;
  function Harness() {
    const relations = createDatabaseRelations({
      columns: () =>
        ['customer', 'billing-customer'].map((id) => ({
          ...nameColumn,
          column: {
            ...nameColumn.column,
            id,
            config: {
              kind: 'link' as const,
              database_id: 'db',
              table_id: 'customers',
            },
          },
        })),
      exec,
    });
    first = relations('customers');
    second = relations('customers');
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await waitFor(() =>
    expect(first.rows()).toEqual([{ id: 'customer-1', name: 'Acme' }])
  );
  expect(second.rows()).toEqual(first.rows());
  expect(transport.get).toHaveBeenCalledTimes(1);
  expect(exec).toHaveBeenCalledTimes(1);
  expect(exec).toHaveBeenCalledWith({
    sql: 'SELECT * FROM "_macro_table_customers"',
  });
  client.setQueryData(
    databasesKeys.rows('db', 'customers').queryKey,
    outcome('Acme renamed')
  );
  await waitFor(() => expect(first.rows()[0].name).toBe('Acme renamed'));
  expect(second.rows()[0].name).toBe('Acme renamed');
  expect(exec).toHaveBeenCalledTimes(1);
});
