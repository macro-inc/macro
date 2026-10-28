import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import { describe, expect, it } from 'vitest';
import { databaseSearchStatements } from './database-search';

const partyPlanner: DatabaseDetail = {
  database: {
    id: 'planner',
    name: 'Party Planner',
    owner_id: 'owner',
    created_at: '',
    trashed_at: null,
  },
  grant: 'owner',
  tables: [
    {
      views: [],
      table: {
        id: 'invites',
        database_id: 'planner',
        name: 'Invites',
        position: 'a',
        version: 3,
      },
      sql_name: '"Party Planner"."Invites"',
      columns: [
        {
          shared_outside_database: false,
          column: {
            id: 'guest',
            table_id: 'invites',
            property_definition_id: 'guest-definition',
            position: 'a',
            config: null,
            display_name: null,
            infer_type: false,
          },
          sql_name: '"Guest"',
          writable: true,
          definition: {
            definition: {
              id: 'guest-definition',
              owner: { scope: 'database', database_id: 'planner' },
              display_name: 'Guest',
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
            id: 'rsvp',
            table_id: 'invites',
            property_definition_id: 'rsvp-definition',
            position: 'b',
            config: null,
            display_name: null,
            infer_type: false,
          },
          sql_name: '"RSVP"',
          writable: true,
          definition: {
            definition: {
              id: 'rsvp-definition',
              owner: { scope: 'database', database_id: 'planner' },
              display_name: 'RSVP',
              data_type: 'SELECT_STRING',
              is_multi_select: false,
              specific_entity_type: null,
              created_at: '',
              updated_at: '',
              is_system: false,
              is_metadata: false,
            },
            property_options: [
              {
                id: 'going',
                property_definition_id: 'rsvp-definition',
                display_order: 0,
                value: { type: 'string', value: 'Going' },
                color: '#889096',
                created_at: '',
                updated_at: '',
              },
              {
                id: 'declined',
                property_definition_id: 'rsvp-definition',
                display_order: 1,
                value: { type: 'string', value: 'Declined' },
                color: '#889096',
                created_at: '',
                updated_at: '',
              },
            ],
          },
        },
      ],
    },
    {
      views: [],
      table: {
        id: 'budget',
        database_id: 'planner',
        name: 'Budget',
        position: 'b',
        version: 1,
      },
      sql_name: '"Party Planner"."Budget"',
      columns: [
        {
          shared_outside_database: false,
          column: {
            id: 'amount',
            table_id: 'budget',
            property_definition_id: 'amount-definition',
            position: 'a',
            config: null,
            display_name: null,
            infer_type: false,
          },
          sql_name: '"Amount"',
          writable: true,
          definition: {
            definition: {
              id: 'amount-definition',
              owner: { scope: 'database', database_id: 'planner' },
              display_name: 'Amount',
              data_type: 'NUMBER',
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
    },
  ],
};

describe('database search statements', () => {
  it('reads each table that can hold the term, testing its text cells and matching option labels', () => {
    expect(databaseSearchStatements(partyPlanner, ' go ')).toEqual([
      {
        table: partyPlanner.tables[0],
        statement: {
          schema: {
            databases: [
              {
                id: 'planner',
                name: 'Party Planner',
                tables: [
                  {
                    id: 'invites',
                    name: 'Invites',
                    columns: [
                      {
                        id: 'guest',
                        definition: 'guest-definition',
                        name: 'Guest',
                        property: {
                          dataType: 'STRING',
                          multi: false,
                          entityType: null,
                          relation: false,
                        },
                        options: [],
                      },
                      {
                        id: 'rsvp',
                        definition: 'rsvp-definition',
                        name: 'RSVP',
                        property: {
                          dataType: 'SELECT_STRING',
                          multi: false,
                          entityType: null,
                          relation: false,
                        },
                        options: [
                          {
                            id: 'going',
                            value: { type: 'string', value: 'Going' },
                            order: 0,
                          },
                          {
                            id: 'declined',
                            value: { type: 'string', value: 'Declined' },
                            order: 1,
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
            platform: ['people'],
          },
          scope: 'planner',
          view: {
            id: 'invites',
            databaseId: 'planner',
            tableId: 'invites',
            name: 'All records',
            position: '80',
            query: {
              filter: {
                conjunction: 'or',
                conditions: [
                  {
                    kind: 'condition',
                    column: 'guest',
                    test: { kind: 'text', operator: 'contains', value: 'go' },
                  },
                  {
                    kind: 'condition',
                    column: 'rsvp',
                    test: {
                      kind: 'options',
                      operator: 'isAnyOf',
                      options: ['going'],
                    },
                  },
                ],
              },
              sort: [],
            },
            layout: { kind: 'table', columns: [] },
            createdAt: '1970-01-01T00:00:00.000Z',
            updatedAt: '1970-01-01T00:00:00.000Z',
          },
        },
      },
    ]);
  });

  it('reads nothing for a blank term', () => {
    expect(databaseSearchStatements(partyPlanner, '   ')).toEqual([]);
  });
});
