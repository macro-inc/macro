import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';

export const databaseId = '01990000-0000-7000-8000-00000000d001';
export const tableId = '01990000-0000-7000-8000-00000000a001';
export const columnId = '01990000-0000-7000-8000-00000000c001';
export const definitionId = '01990000-0000-7000-8000-00000000f001';
export const rowId = '01990000-0000-7000-8000-00000000e001';

export function documentDatabaseDetail(): DatabaseDetail {
  return {
    database: {
      id: databaseId,
      name: 'Launch tasks',
      owner_id: 'macro|fixture@example.com',
      created_at: '2026-10-09T00:00:00Z',
      trashed_at: null,
    },
    grant: 'owner',
    tables: [
      {
        table: {
          id: tableId,
          database_id: databaseId,
          name: 'Tasks',
          position: '80',
          version: 1,
        },
        sql_name: '"Launch tasks"."Tasks"',
        views: [],
        columns: [
          {
            column: {
              id: columnId,
              table_id: tableId,
              property_definition_id: definitionId,
              position: '80',
              config: null,
              display_name: null,
              infer_type: false,
            },
            sql_name: '"Name"',
            writable: true,
            shared_outside_database: false,
            definition: {
              definition: {
                id: definitionId,
                display_name: 'Name',
                data_type: 'STRING',
                owner: { scope: 'database', database_id: databaseId },
                is_multi_select: false,
                specific_entity_type: null,
                is_system: false,
                is_metadata: false,
                created_at: '',
                updated_at: '',
              },
              property_options: [],
            },
          },
        ],
      },
    ],
  };
}
