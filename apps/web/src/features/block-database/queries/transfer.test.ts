import { databaseSqlSchema } from '@core/database-sql/catalog';
import type { Catalog } from '@core/database-sql/generated/types';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { errAsync, ok, okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { exportDatabaseTableCsv, importDatabaseTable } from './transfer';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  import: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('@queries/database-sql/create-database-sql-query', () => ({
  readDatabaseSql: mocks.read,
}));
vi.mock('@queries/storage/databases', () => ({
  invalidateDatabase: mocks.invalidate,
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { databases: { importTable: mocks.import } },
}));
const table: TableDetail = {
  table: {
    id: 'table',
    database_id: 'database',
    name: 'Contacts',
    position: 'a',
    version: 1,
  },
  sql_name: '"CRM"."Contacts"',
  views: [],
  columns: [
    {
      shared_outside_database: false,
      column: {
        id: 'name',
        table_id: 'table',
        property_definition_id: 'name-definition',
        position: 'a',
        config: null,
        display_name: 'Customer',
        infer_type: false,
      },
      sql_name: '"Customer"',
      writable: true,
      definition: {
        definition: {
          id: 'name-definition',
          owner: { scope: 'database', database_id: 'database' },
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
    },
    {
      shared_outside_database: false,
      column: {
        id: 'tags',
        table_id: 'table',
        property_definition_id: 'tags-definition',
        position: 'b',
        config: null,
        display_name: null,
        infer_type: false,
      },
      sql_name: '"Tags"',
      writable: true,
      definition: {
        definition: {
          id: 'tags-definition',
          owner: { scope: 'database', database_id: 'database' },
          display_name: 'Tags',
          data_type: 'TAG',
          is_multi_select: true,
          specific_entity_type: null,
          created_at: '',
          updated_at: '',
          is_system: false,
          is_metadata: false,
        },
        property_options: [
          {
            id: 'vip',
            property_definition_id: 'tags-definition',
            display_order: 0,
            value: { type: 'string', value: 'VIP' },
            color: '#889096',
            created_at: '',
            updated_at: '',
          },
          {
            id: 'lead',
            property_definition_id: 'tags-definition',
            display_order: 1,
            value: { type: 'string', value: 'Lead' },
            color: '#889096',
            created_at: '',
            updated_at: '',
          },
        ],
      },
    },
    {
      shared_outside_database: false,
      column: {
        id: 'active',
        table_id: 'table',
        property_definition_id: 'active-definition',
        position: 'c',
        config: null,
        display_name: null,
        infer_type: false,
      },
      sql_name: '"Active"',
      writable: true,
      definition: {
        definition: {
          id: 'active-definition',
          owner: { scope: 'database', database_id: 'database' },
          display_name: 'Active',
          data_type: 'BOOLEAN',
          is_multi_select: false,
          specific_entity_type: null,
          created_at: '',
          updated_at: '',
          is_system: false,
          is_metadata: false,
        },
        property_options: [],
      },
    },
  ],
};
const database: DatabaseDetail = {
  database: {
    id: 'database',
    name: 'CRM',
    owner_id: 'owner',
    created_at: '',
    trashed_at: null,
  },
  grant: 'view',
  tables: [table],
};
/** The catalog the engine builds of `database`. */
const catalog: Catalog = {
  tables: [
    {
      id: 'table',
      databaseId: 'database',
      database: 'CRM',
      name: 'Contacts',
      source: 'database',
      columns: [
        {
          id: 'name-definition',
          placement: 'name',
          name: 'Customer',
          kind: { kind: 'text' },
        },
        {
          id: 'tags-definition',
          placement: 'tags',
          name: 'Tags',
          kind: {
            kind: 'select',
            multi: true,
            options: [
              { id: 'vip', label: 'VIP' },
              { id: 'lead', label: 'Lead' },
            ],
          },
        },
        {
          id: 'active-definition',
          placement: 'active',
          name: 'Active',
          kind: { kind: 'boolean' },
        },
      ],
    },
  ],
};

describe('CSV transfers', () => {
  it('exports user-facing headers and values as the grid shows them, quoted, without row ids, in table order', async () => {
    mocks.read.mockReturnValueOnce(
      okAsync({
        catalog,
        outcome: {
          columns: [
            { name: 'Customer', column: 'name-definition', kind: 'text' },
            { name: 'Tags', column: 'tags-definition', kind: 'select' },
            { name: 'Active', column: 'active-definition', kind: 'boolean' },
          ],
          rows: [
            [
              { type: 'text', value: '00123' },
              { type: 'options', value: ['vip', 'lead'] },
              { type: 'bool', value: true },
            ],
            [
              { type: 'text', value: 'a,b' },
              null,
              { type: 'bool', value: false },
            ],
          ],
          rowIds: ['id-0', 'id-1'],
          readTables: ['table'],
          truncated: false,
          insertedRowIds: [],
          changesApplied: 0,
        },
      })
    );
    const blob = (
      await exportDatabaseTableCsv(database, table)
    )._unsafeUnwrap();
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(blob);
    });
    expect(text).toBe(
      'Customer,Tags,Active\n00123,"VIP, Lead",True\n"a,b",,False'
    );
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith({
      schema: databaseSqlSchema([database]),
      scope: 'database',
      sql: 'SELECT * FROM "CRM"."Contacts" ORDER BY row_position',
    });
  });
  it('refuses a truncated read instead of downloading partial CSV', async () => {
    mocks.read.mockReturnValueOnce(
      okAsync({
        catalog,
        outcome: {
          columns: [],
          rows: [],
          rowIds: [],
          readTables: ['table'],
          truncated: true,
          insertedRowIds: [],
          changesApplied: 0,
        },
      })
    );
    expect(await exportDatabaseTableCsv(database, table)).toMatchObject({
      error: { kind: 'too-large' },
    });
  });
  it('retains the same import identity and reports validation errors', async () => {
    const request = {
      requestId: 'request',
      name: 'Contacts',
      columns: ['Name'],
      rows: [['Ada']],
    };
    mocks.import.mockReturnValueOnce(
      errAsync([{ code: 'INVALID_SCHEMA', message: 'Choose another name.' }])
    );
    expect(await importDatabaseTable('database', request)).toMatchObject({
      error: [{ code: 'INVALID_SCHEMA', message: 'Choose another name.' }],
    });
    mocks.import.mockReturnValueOnce(okAsync({ id: 'imported' }));
    expect(await importDatabaseTable('database', request)).toEqual(
      ok({ id: 'imported' })
    );
    expect(mocks.import).toHaveBeenLastCalledWith({ id: 'database', request });
    expect(mocks.invalidate).toHaveBeenCalledWith('database');
  });
});
