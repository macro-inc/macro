import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import { describe, expect, it } from 'vitest';
import { databaseSqlAnswer } from './answer';
import type { Catalog } from './generated/types';

const timestamps = {
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const party: DatabaseDetail = {
  database: {
    id: 'db-party',
    name: 'Party Planner',
    owner_id: 'macro|owner@databases.test',
    created_at: '2026-01-01T00:00:00Z',
    trashed_at: null,
  },
  grant: 'edit',
  tables: [
    {
      views: [],
      table: {
        id: 'table-guests',
        database_id: 'db-party',
        name: 'Guests',
        position: '000000000001',
        version: 7,
      },
      sql_name: '"Party Planner"."Guests"',
      columns: [
        {
          shared_outside_database: false,
          column: {
            id: 'column-name',
            table_id: 'table-guests',
            property_definition_id: 'def-name',
            position: '000000000001',
            config: null,
            display_name: null,
            infer_type: false,
          },
          sql_name: '"Name"',
          writable: true,
          definition: {
            definition: {
              id: 'def-name',
              owner: { scope: 'database', database_id: 'db-party' },
              display_name: 'Name',
              data_type: 'STRING',
              is_multi_select: false,
              specific_entity_type: null,
              is_system: false,
              is_metadata: false,
              ...timestamps,
            },
            property_options: [],
          },
        },
        {
          shared_outside_database: false,
          column: {
            id: 'column-rsvp',
            table_id: 'table-guests',
            property_definition_id: 'def-rsvp',
            position: '000000000002',
            config: null,
            display_name: null,
            infer_type: false,
          },
          sql_name: '"RSVP"',
          writable: true,
          definition: {
            definition: {
              id: 'def-rsvp',
              owner: { scope: 'database', database_id: 'db-party' },
              display_name: 'RSVP',
              data_type: 'SELECT_STRING',
              is_multi_select: false,
              specific_entity_type: null,
              is_system: false,
              is_metadata: false,
              ...timestamps,
            },
            property_options: [
              {
                id: 'option-yes',
                property_definition_id: 'def-rsvp',
                display_order: 0,
                value: { type: 'string', value: 'Yes' },
                color: '#2f9e44',
                ...timestamps,
              },
            ],
          },
        },
        {
          shared_outside_database: false,
          column: {
            id: 'column-diet',
            table_id: 'table-guests',
            property_definition_id: 'def-diet',
            position: '000000000003',
            config: null,
            display_name: null,
            infer_type: false,
          },
          sql_name: '"Diet"',
          writable: true,
          definition: {
            definition: {
              id: 'def-diet',
              owner: { scope: 'database', database_id: 'db-party' },
              display_name: 'Diet',
              data_type: 'SELECT_STRING',
              is_multi_select: true,
              specific_entity_type: null,
              is_system: false,
              is_metadata: false,
              ...timestamps,
            },
            property_options: [
              {
                id: 'option-vegan',
                property_definition_id: 'def-diet',
                display_order: 0,
                color: null,
                value: { type: 'string', value: 'Vegan' },
                ...timestamps,
              },
              {
                id: 'option-nuts',
                property_definition_id: 'def-diet',
                display_order: 1,
                color: null,
                value: { type: 'string', value: 'No nuts' },
                ...timestamps,
              },
            ],
          },
        },
        {
          shared_outside_database: false,
          column: {
            id: 'column-parties',
            table_id: 'table-guests',
            property_definition_id: 'def-parties',
            position: '000000000004',
            config: {
              kind: 'link',
              database_id: 'db-party',
              table_id: 'table-parties',
            },
            display_name: null,
            infer_type: false,
          },
          sql_name: '"Parties"',
          writable: true,
          definition: {
            definition: {
              id: 'def-parties',
              owner: { scope: 'database', database_id: 'db-party' },
              display_name: 'Parties',
              data_type: 'ENTITY',
              is_multi_select: true,
              specific_entity_type: 'DATABASE_ROW',
              is_system: false,
              is_metadata: false,
              ...timestamps,
            },
            property_options: [],
          },
        },
        {
          shared_outside_database: false,
          column: {
            id: 'column-host',
            table_id: 'table-guests',
            property_definition_id: 'def-host',
            position: '000000000005',
            config: null,
            display_name: null,
            infer_type: false,
          },
          sql_name: '"Host"',
          writable: true,
          definition: {
            definition: {
              id: 'def-host',
              owner: { scope: 'database', database_id: 'db-party' },
              display_name: 'Host',
              data_type: 'ENTITY',
              is_multi_select: false,
              specific_entity_type: 'USER',
              is_system: false,
              is_metadata: false,
              ...timestamps,
            },
            property_options: [],
          },
        },
        {
          shared_outside_database: false,
          column: {
            id: 'column-arrives',
            table_id: 'table-guests',
            property_definition_id: 'def-arrives',
            position: '000000000006',
            config: null,
            display_name: null,
            infer_type: false,
          },
          sql_name: '"Arrives"',
          writable: true,
          definition: {
            definition: {
              id: 'def-arrives',
              owner: { scope: 'database', database_id: 'db-party' },
              display_name: 'Arrives',
              data_type: 'DATE',
              is_multi_select: false,
              specific_entity_type: null,
              is_system: false,
              is_metadata: false,
              ...timestamps,
            },
            property_options: [],
          },
        },
        {
          shared_outside_database: false,
          column: {
            id: 'column-plus-one',
            table_id: 'table-guests',
            property_definition_id: 'def-plus-one',
            position: '000000000007',
            config: null,
            display_name: null,
            infer_type: false,
          },
          sql_name: '"Plus one"',
          writable: true,
          definition: {
            definition: {
              id: 'def-plus-one',
              owner: { scope: 'database', database_id: 'db-party' },
              display_name: 'Plus one',
              data_type: 'BOOLEAN',
              is_multi_select: false,
              specific_entity_type: null,
              is_system: false,
              is_metadata: false,
              ...timestamps,
            },
            property_options: [],
          },
        },
      ],
    },
  ],
};

const catalog: Catalog = {
  tables: [
    {
      id: 'table-guests',
      databaseId: 'database-party-planner',
      database: 'Party Planner',
      name: 'Guests',
      source: 'database',
      columns: [
        {
          id: 'def-name',
          placement: 'column-name',
          name: 'Name',
          kind: { kind: 'text' },
        },
        {
          id: 'def-rsvp',
          placement: 'column-rsvp',
          name: 'RSVP',
          kind: {
            kind: 'select',
            multi: false,
            options: [{ id: 'option-yes', label: 'Yes' }],
          },
        },
        {
          id: 'def-diet',
          placement: 'column-diet',
          name: 'Diet',
          kind: {
            kind: 'select',
            multi: true,
            options: [
              { id: 'option-vegan', label: 'Vegan' },
              { id: 'option-nuts', label: 'No nuts' },
            ],
          },
        },
        {
          id: 'def-parties',
          placement: 'column-parties',
          name: 'Parties',
          kind: { kind: 'entity', multi: true, target: 'DATABASE_ROW' },
        },
        {
          id: 'def-host',
          placement: 'column-host',
          name: 'Host',
          kind: { kind: 'entity', multi: false, target: 'USER' },
        },
        {
          id: 'def-arrives',
          placement: 'column-arrives',
          name: 'Arrives',
          kind: { kind: 'date' },
        },
        {
          id: 'def-plus-one',
          placement: 'column-plus-one',
          name: 'Plus one',
          kind: { kind: 'boolean' },
        },
      ],
    },
  ],
};

const noSource = {
  markdown: false,
  options: [],
  tag: false,
  target: null,
  relatedTable: null,
};

describe('databaseSqlAnswer', () => {
  it('keeps the typed cells and says what each column was read from', () => {
    const answer = databaseSqlAnswer(
      {
        columns: [
          { name: 'Name', column: 'def-name', kind: 'text' },
          { name: 'RSVP', column: 'def-rsvp', kind: 'select' },
          { name: 'Diet', column: 'def-diet', kind: 'select' },
          { name: 'Parties', column: 'def-parties', kind: 'entity' },
          { name: 'Host', column: 'def-host', kind: 'entity' },
          { name: 'Arrives', column: 'def-arrives', kind: 'date' },
          { name: 'Plus one', column: 'def-plus-one', kind: 'boolean' },
        ],
        rows: [
          [
            { type: 'text', value: 'Ada' },
            { type: 'options', value: ['option-yes'] },
            { type: 'options', value: ['option-vegan', 'option-nuts'] },
            { type: 'entities', value: ['row-party'] },
            { type: 'entities', value: ['macro|ada@databases.test'] },
            { type: 'date', value: '2026-06-01T18:30:00Z' },
            { type: 'bool', value: true },
          ],
          [
            { type: 'text', value: 'Grace' },
            null,
            null,
            null,
            null,
            null,
            { type: 'bool', value: false },
          ],
        ],
        rowIds: ['row-ada', 'row-grace'],
        readTables: ['table-guests'],
        truncated: false,
        insertedRowIds: [],
        changesApplied: 0,
      },
      catalog,
      [party]
    );

    expect(answer).toEqual({
      columns: [
        {
          name: 'Name',
          kind: 'text',
          source: { ...noSource, markdown: true },
        },
        {
          name: 'RSVP',
          kind: 'select',
          source: {
            ...noSource,
            options: [{ id: 'option-yes', label: 'Yes', color: '#2f9e44' }],
          },
        },
        {
          name: 'Diet',
          kind: 'select',
          source: {
            ...noSource,
            options: [
              { id: 'option-vegan', label: 'Vegan', color: null },
              { id: 'option-nuts', label: 'No nuts', color: null },
            ],
          },
        },
        {
          name: 'Parties',
          kind: 'entity',
          source: {
            ...noSource,
            target: 'DATABASE_ROW',
            relatedTable: 'table-parties',
          },
        },
        {
          name: 'Host',
          kind: 'entity',
          source: { ...noSource, target: 'USER' },
        },
        { name: 'Arrives', kind: 'date', source: noSource },
        { name: 'Plus one', kind: 'boolean', source: noSource },
      ],
      rows: [
        [
          { type: 'text', value: 'Ada' },
          { type: 'options', value: ['option-yes'] },
          { type: 'options', value: ['option-vegan', 'option-nuts'] },
          { type: 'entities', value: ['row-party'] },
          { type: 'entities', value: ['macro|ada@databases.test'] },
          { type: 'date', value: '2026-06-01T18:30:00Z' },
          { type: 'bool', value: true },
        ],
        [
          { type: 'text', value: 'Grace' },
          null,
          null,
          null,
          null,
          null,
          { type: 'bool', value: false },
        ],
      ],
      rowIds: ['row-ada', 'row-grace'],
      readTables: ['table-guests'],
      readDatabaseIds: ['db-party'],
      truncatedTables: [],
    });
  });

  it('leaves an aggregate without a source and names truncated tables', () => {
    const answer = databaseSqlAnswer(
      {
        columns: [
          { name: 'RSVP', column: 'def-rsvp', kind: 'select' },
          { name: 'COUNT(*)', kind: 'number' },
        ],
        rows: [
          [
            { type: 'options', value: ['option-yes'] },
            { type: 'number', value: 2 },
          ],
          [null, { type: 'number', value: 1 }],
        ],
        rowIds: [],
        readTables: ['table-guests'],
        truncated: true,
        insertedRowIds: [],
        changesApplied: 0,
      },
      catalog,
      [party]
    );

    expect(answer.columns[1]).toEqual({ name: 'COUNT(*)', kind: 'number' });
    expect(answer.rowIds).toEqual([]);
    expect(answer.truncatedTables).toEqual(['Guests']);
  });

  it('reads a row_id column as rows of the table it names', () => {
    const answer = databaseSqlAnswer(
      {
        columns: [{ name: 'row_id', kind: 'row', table: 'table-guests' }],
        rows: [[{ type: 'row', value: 'row-ada' }]],
        rowIds: ['row-ada'],
        readTables: ['table-guests'],
        truncated: false,
        insertedRowIds: [],
        changesApplied: 0,
      },
      catalog,
      [party]
    );

    expect(answer.columns).toEqual([
      {
        name: 'row_id',
        kind: 'row',
        source: {
          markdown: false,
          options: [],
          tag: false,
          target: null,
          relatedTable: 'table-guests',
        },
      },
    ]);
    expect(answer.rows).toEqual([[{ type: 'row', value: 'row-ada' }]]);
  });

  it('labels options from the catalog when the database detail is not loaded', () => {
    const answer = databaseSqlAnswer(
      {
        columns: [{ name: 'RSVP', column: 'def-rsvp', kind: 'select' }],
        rows: [[{ type: 'options', value: ['option-yes'] }]],
        rowIds: ['row-ada'],
        readTables: ['table-guests'],
        truncated: false,
        insertedRowIds: [],
        changesApplied: 0,
      },
      catalog,
      []
    );

    expect(answer.columns).toEqual([
      {
        name: 'RSVP',
        kind: 'select',
        source: {
          ...noSource,
          options: [{ id: 'option-yes', label: 'Yes', color: null }],
        },
      },
    ]);
    expect(answer.readDatabaseIds).toEqual([]);
  });
});
