import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';

/** Synthetic schema shared by the adapter and browser rename regressions. */
export const RENAME_DETAIL: DatabaseDetail = {
  database: {
    id: 'db',
    name: 'Planning',
    owner_id: 'owner',
    created_at: '',
    trashed_at: null,
  },
  grant: 'owner',
  tables: [
    {
      table: {
        id: 'tasks',
        database_id: 'db',
        name: 'Tasks',
        position: 'a',
        version: 1,
      },
      sql_name: '"Tasks"',
      views: [],
      columns: [
        {
          column: {
            id: 'name',
            table_id: 'tasks',
            property_definition_id: 'property',
            position: 'a',
            config: null,
            display_name: null,
            infer_type: false,
          },
          definition: {
            definition: {
              id: 'property',
              display_name: 'Name',
              data_type: 'STRING',
              is_multi_select: false,
              is_metadata: false,
              is_system: false,
              specific_entity_type: null,
              owner: { scope: 'database', database_id: 'db' },
              created_at: '',
              updated_at: '',
            },
            property_options: [],
          },
          sql_name: '"Name"',
          shared_outside_database: false,
          writable: true,
        },
      ],
    },
  ],
};
