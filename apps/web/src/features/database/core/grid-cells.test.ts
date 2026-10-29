import { describe, expect, it } from 'vitest';
import { gridRows, keepUnchangedRows, UNAVAILABLE_OPTION } from './grid-cells';

describe('engine cells as grid values', () => {
  it('shows an option the catalog lacks instead of dropping it', () => {
    expect(
      gridRows(
        {
          columns: [
            {
              name: 'Tags',
              column: 'definition',
              kind: 'select',
            },
          ],
          rows: [[{ type: 'options', value: ['urgent', 'added-elsewhere'] }]],
          rowIds: ['row-1'],
          readTables: ['table'],
          truncated: false,
          insertedRowIds: [],
          changesApplied: 0,
        },
        {
          tables: [
            {
              id: 'table',
              databaseId: 'db',
              database: 'Projects',
              name: 'Tasks',
              columns: [
                {
                  id: 'definition',
                  placement: 'column',
                  name: 'Tags',
                  kind: {
                    kind: 'select',
                    multi: true,
                    options: [{ id: 'urgent', label: 'Urgent' }],
                  },
                },
              ],
            },
          ],
        },
        [
          {
            shared_outside_database: false,
            column: {
              id: 'column',
              table_id: 'table',
              property_definition_id: 'definition',
              position: 'a',
              config: null,
              display_name: null,
              infer_type: false,
            },
            sql_name: '"Tags"',
            writable: true,
            definition: {
              definition: {
                id: 'definition',
                owner: { scope: 'database', database_id: 'db' },
                display_name: 'Tags',
                data_type: 'TAG',
                is_multi_select: true,
                specific_entity_type: null,
                created_at: '',
                updated_at: '',
                is_system: false,
                is_metadata: false,
              },
              property_options: [],
            },
          },
        ]
      )
    ).toEqual([
      {
        rowId: 'row-1',
        cells: { column: JSON.stringify(['Urgent', UNAVAILABLE_OPTION]) },
      },
    ]);
  });
});

describe('engine date ranges as grid values', () => {
  it('holds a range as the ISO interval of its two instants', () => {
    expect(
      gridRows(
        {
          columns: [{ name: 'Trip', column: 'definition', kind: 'dateRange' }],
          rows: [
            [
              {
                type: 'dateRange',
                value: {
                  start: '2026-03-01T00:00:00Z',
                  end: '2026-03-05T00:00:00Z',
                },
              },
            ],
            [null],
          ],
          rowIds: ['row-1', 'row-2'],
          readTables: ['table'],
          truncated: false,
          insertedRowIds: [],
          changesApplied: 0,
        },
        {
          tables: [
            {
              id: 'table',
              databaseId: 'db',
              database: 'Travel',
              name: 'Trips',
              columns: [
                {
                  id: 'definition',
                  placement: 'column',
                  name: 'Trip',
                  kind: { kind: 'dateRange' },
                },
              ],
            },
          ],
        },
        [
          {
            shared_outside_database: false,
            column: {
              id: 'column',
              table_id: 'table',
              property_definition_id: 'definition',
              position: 'a',
              config: null,
              display_name: null,
              infer_type: false,
            },
            sql_name: '"Trip"',
            writable: true,
            definition: {
              definition: {
                id: 'definition',
                owner: { scope: 'database', database_id: 'db' },
                display_name: 'Trip',
                data_type: 'DATE_RANGE',
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
        ]
      )
    ).toEqual([
      {
        rowId: 'row-1',
        cells: { column: '2026-03-01T00:00:00Z/2026-03-05T00:00:00Z' },
      },
      { rowId: 'row-2', cells: { column: null } },
    ]);
  });
});

describe('a new read of rows the grid already shows', () => {
  it('hands back the shown row for each row whose cells read the same', () => {
    const ada = { rowId: 'ada', cells: { name: 'Ada', guests: 2 } };
    const grace = { rowId: 'grace', cells: { name: 'Grace', guests: 1 } };
    const linus = { rowId: 'linus', cells: { name: 'Linus', guests: null } };

    const kept = keepUnchangedRows(
      [ada, grace, linus],
      [
        { rowId: 'grace', cells: { name: 'Grace', guests: 3 } },
        { rowId: 'ada', cells: { name: 'Ada', guests: 2 } },
        { rowId: 'linus', cells: { name: 'Linus', guests: null, rsvp: null } },
        { rowId: 'margaret', cells: { name: 'Margaret', guests: 4 } },
      ]
    );

    expect(kept).toEqual([
      { rowId: 'grace', cells: { name: 'Grace', guests: 3 } },
      { rowId: 'ada', cells: { name: 'Ada', guests: 2 } },
      { rowId: 'linus', cells: { name: 'Linus', guests: null, rsvp: null } },
      { rowId: 'margaret', cells: { name: 'Margaret', guests: 4 } },
    ]);
    // Only Ada reads exactly as shown; a changed value or a new column is new.
    expect(kept[1]).toBe(ada);
    expect(kept[0]).not.toBe(grace);
    expect(kept[2]).not.toBe(linus);
  });
});
