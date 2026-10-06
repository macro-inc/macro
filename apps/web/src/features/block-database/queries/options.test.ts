import { queryClient } from '@queries/client';
import { databasesKeys } from '@queries/storage/keys';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import { err, okAsync } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateDatabaseOption } from './options';

const transport = vi.hoisted(() => ({
  applyDatabaseOps: vi.fn(),
  applyDatabaseTableVersions: vi.fn(),
  invalidateDatabase: vi.fn(),
}));
vi.mock('@queries/storage/databases', () => transport);
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

afterEach(() => {
  queryClient.clear();
  vi.resetAllMocks();
});

const detail: DatabaseDetail = {
  database: {
    id: 'db',
    name: 'Party Planner',
    owner_id: 'owner',
    created_at: '',
    trashed_at: null,
  },
  grant: 'owner',
  tables: [
    {
      table: {
        id: 'invites',
        database_id: 'db',
        name: 'Invites',
        position: 'a',
        version: 3,
      },
      sql_name: '"Invites"',
      views: [],
      columns: [
        {
          shared_outside_database: false,
          column: {
            id: 'guests',
            table_id: 'invites',
            property_definition_id: 'guests-definition',
            position: 'a',
            config: null,
            display_name: null,
            infer_type: false,
          },
          sql_name: '"Guests"',
          writable: true,
          definition: {
            definition: {
              id: 'guests-definition',
              owner: { scope: 'database', database_id: 'db' },
              display_name: 'Guests',
              data_type: 'SELECT_NUMBER',
              is_multi_select: false,
              specific_entity_type: null,
              created_at: '',
              updated_at: '',
              is_system: false,
              is_metadata: false,
            },
            property_options: [
              {
                id: 'two',
                property_definition_id: 'guests-definition',
                display_order: 0,
                value: { type: 'number', value: 2 },
                color: '#889096',
                created_at: '',
                updated_at: '',
              },
            ],
          },
        },
      ],
    },
  ],
};

const target = {
  databaseId: 'db',
  tableId: 'invites',
  columnId: 'guests',
  optionId: 'two',
};

function cachedOption() {
  return queryClient.getQueryData<DatabaseDetail>(
    databasesKeys.detail('db').queryKey
  )?.tables[0].columns[0].definition.property_options[0];
}

describe('changing an option', () => {
  it('shows a number option’s new label and colour before the answer', async () => {
    queryClient.setQueryData(databasesKeys.detail('db').queryKey, detail);
    transport.applyDatabaseOps.mockReturnValue(
      okAsync([
        {
          kind: 'column',
          table: 'invites',
          column: 'guests',
          tableVersion: 4,
          change: { kind: 'option_updated' },
        },
      ])
    );

    const updated = await updateDatabaseOption(target, {
      label: ' 3 ',
      color: '#0091FF',
    });

    expect(updated.isOk()).toBe(true);
    expect(cachedOption()).toEqual({
      id: 'two',
      property_definition_id: 'guests-definition',
      display_order: 0,
      value: { type: 'number', value: 3 },
      color: '#0091FF',
      created_at: '',
      updated_at: '',
    });
    expect(transport.applyDatabaseOps).toHaveBeenCalledExactlyOnceWith('db', [
      {
        kind: 'column',
        table: 'invites',
        column: 'guests',
        change: {
          kind: 'update_option',
          option: 'two',
          label: ' 3 ',
          color: '#0091FF',
        },
      },
    ]);
  });

  it('refuses a label that is not a number for a number option without sending it', async () => {
    queryClient.setQueryData(databasesKeys.detail('db').queryKey, detail);

    expect(await updateDatabaseOption(target, { label: 'many' })).toEqual(
      err({ kind: 'not-a-number' })
    );
    expect(cachedOption()?.value).toEqual({ type: 'number', value: 2 });
    expect(transport.applyDatabaseOps).not.toHaveBeenCalled();
  });
});
