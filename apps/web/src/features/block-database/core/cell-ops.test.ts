import type { ColumnDetail } from '@service-storage/generated/schemas/columnDetail';
import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { cellValue, missingOptionLabels, mutationOp } from './cell-ops';
import { UNAVAILABLE_OPTION } from './grid-cells';

function column(
  dataType: ColumnDetail['definition']['definition']['data_type'],
  options: {
    multi?: boolean;
    entityType?: 'USER' | 'DOCUMENT';
    relation?: boolean;
  } = {}
): ColumnDetail {
  return {
    shared_outside_database: false,
    column: {
      id: 'column',
      table_id: 'table',
      property_definition_id: 'definition',
      position: 'a',
      config: options.relation
        ? { kind: 'link', database_id: 'db', table_id: 'related' }
        : null,
      display_name: null,
      infer_type: false,
    },
    sql_name: '"Column"',
    writable: true,
    definition: {
      definition: {
        id: 'definition',
        owner: { scope: 'database', database_id: 'db' },
        display_name: 'Column',
        data_type: dataType,
        is_multi_select: options.multi ?? false,
        specific_entity_type: options.entityType ?? null,
        created_at: '',
        updated_at: '',
        is_system: false,
        is_metadata: false,
      },
      property_options: [],
    },
  };
}

describe('grid values as cell values', () => {
  it('names options by label, one for a single select and each for a multi select', () => {
    expect(cellValue(column('SELECT_STRING'), 'Going')).toEqual(
      ok({
        type: 'options',
        value: [{ label: 'Going' }],
      })
    );
    expect(
      cellValue(column('TAG', { multi: true }), '["Urgent","Backend"]')
    ).toEqual(
      ok({
        type: 'options',
        value: [{ label: 'Urgent' }, { label: 'Backend' }],
      })
    );
    expect(cellValue(column('SELECT_NUMBER', { multi: true }), '[]')).toEqual(
      ok({
        type: 'clear',
      })
    );
  });

  it('writes references with the kind the column points at, and relations as rows', () => {
    expect(
      cellValue(column('ENTITY', { entityType: 'DOCUMENT' }), 'document-1')
    ).toEqual(
      ok({
        type: 'entities',
        value: [{ entityType: 'DOCUMENT', entityId: 'document-1' }],
      })
    );
    expect(
      cellValue(
        column('ENTITY', { relation: true, multi: true }),
        '["row-1","row-2"]'
      )
    ).toEqual(ok({ type: 'rows', value: ['row-1', 'row-2'] }));
    expect(cellValue(column('ENTITY', { relation: true }), '[]')).toEqual(
      ok({
        type: 'clear',
      })
    );
  });

  it('keeps empty text but clears any other empty cell', () => {
    expect(cellValue(column('STRING'), '')).toEqual(
      ok({
        type: 'text',
        value: '',
      })
    );
    expect(cellValue(column('LINK'), '')).toEqual(ok({ type: 'clear' }));
    expect(cellValue(column('NUMBER'), '')).toEqual(ok({ type: 'clear' }));
    expect(cellValue(column('DATE'), null)).toEqual(ok({ type: 'clear' }));
  });

  it('writes checkboxes, numbers, links and dates as the values they are', () => {
    expect(cellValue(column('BOOLEAN'), 1)).toEqual(
      ok({
        type: 'boolean',
        value: true,
      })
    );
    expect(cellValue(column('BOOLEAN'), 'false')).toEqual(
      ok({
        type: 'boolean',
        value: false,
      })
    );
    expect(cellValue(column('NUMBER'), '12.5')).toEqual(
      ok({
        type: 'number',
        value: 12.5,
      })
    );
    expect(cellValue(column('LINK'), 'https://macro.com')).toEqual(
      ok({
        type: 'link',
        value: ['https://macro.com'],
      })
    );
    expect(cellValue(column('DATE'), '2026-09-30')).toEqual(
      ok({
        type: 'date',
        value: '2026-09-30T00:00:00Z',
      })
    );
    expect(cellValue(column('NUMBER'), 'lots')).toEqual(
      err({ kind: 'not-a-number' })
    );
  });

  it('refuses numbers the column inference would not read as one', () => {
    expect(cellValue(column('NUMBER'), ' ')).toEqual(
      err({ kind: 'not-a-number' })
    );
    expect(cellValue(column('NUMBER'), '0x10')).toEqual(
      err({ kind: 'not-a-number' })
    );
    expect(cellValue(column('NUMBER'), ' 42 ')).toEqual(
      ok({ type: 'number', value: 42 })
    );
  });
});

describe('grid values a column cannot take', () => {
  it('refuses references to rows outside a relation column', () => {
    const rows: ColumnDetail = {
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
      sql_name: '"Parties"',
      writable: true,
      definition: {
        definition: {
          id: 'definition',
          owner: { scope: 'database', database_id: 'db' },
          display_name: 'Parties',
          data_type: 'ENTITY',
          is_multi_select: false,
          specific_entity_type: 'DATABASE_ROW',
          created_at: '',
          updated_at: '',
          is_system: false,
          is_metadata: false,
        },
        property_options: [],
      },
    };

    expect(cellValue(rows, 'row-1')).toEqual(
      err({ kind: 'relation-as-entity' })
    );
  });

  it('refuses a multi-valued cell that is not a JSON array instead of clearing it', () => {
    expect(cellValue(column('TAG', { multi: true }), 'Urgent')).toEqual(
      err({ kind: 'malformed-list' })
    );
    expect(cellValue(column('TAG', { multi: true }), '{"a":1}')).toEqual(
      err({ kind: 'malformed-list' })
    );
    expect(cellValue(column('TAG', { multi: true }), '[null]')).toEqual(
      err({ kind: 'malformed-list' })
    );
    expect(cellValue(column('ENTITY', { relation: true }), 'row-1')).toEqual(
      err({ kind: 'malformed-list' })
    );
  });

  it('refuses a bare id for an entity column that names no kind', () => {
    expect(cellValue(column('ENTITY'), 'someone')).toEqual(
      err({ kind: 'untyped-entity' })
    );
  });

  it('refuses an option the grid could not name', () => {
    expect(
      cellValue(
        column('TAG', { multi: true }),
        JSON.stringify(['Urgent', UNAVAILABLE_OPTION])
      )
    ).toEqual(err({ kind: 'unavailable-option' }));
  });

  it('refuses the whole op when one of its cells is refused', () => {
    expect(
      mutationOp(
        'table',
        { kind: 'create', values: { name: 'Ada', age: 'old' } },
        (columnId) =>
          columnId === 'name'
            ? ok(column('STRING'))
            : err({ kind: 'read-only-column' })
      )
    ).toEqual(err({ kind: 'read-only-column' }));
  });
});

describe('grid edits as ops', () => {
  it('deletes a record as one rows delete op', () => {
    expect(
      mutationOp('table', { kind: 'delete', rowId: 'row-1' }, () =>
        ok(column('STRING'))
      )
    ).toEqual(
      ok({
        kind: 'rows',
        table: 'table',
        change: { kind: 'delete', rows: ['row-1'] },
      })
    );
  });

  it('creates a record with every value it starts with, naming options by label', () => {
    expect(
      mutationOp(
        'table',
        { kind: 'create', values: { status: 'New lane' } },
        () => ok(column('SELECT_STRING'))
      )
    ).toEqual(
      ok({
        kind: 'rows',
        table: 'table',
        change: {
          kind: 'insert',
          rows: [
            [
              {
                column: 'status',
                value: { type: 'options', value: [{ label: 'New lane' }] },
              },
            ],
          ],
        },
      })
    );
  });

  it('lists the labels a write names that its columns lack, once each', () => {
    expect(
      missingOptionLabels(
        {
          kind: 'rows',
          table: 'table',
          change: {
            kind: 'update',
            changes: {
              kind: 'per_row',
              rows: [
                {
                  row: 'row-1',
                  cells: [
                    {
                      column: 'tags',
                      value: {
                        type: 'options',
                        value: [
                          { label: 'urgent' },
                          { label: 'Blocked' },
                          { label: 'blocked' },
                          { id: 'option-1' },
                        ],
                      },
                    },
                    { column: 'name', value: { type: 'text', value: 'Ada' } },
                  ],
                },
              ],
            },
          },
        },
        (columnId) => (columnId === 'tags' ? ['Urgent'] : [])
      )
    ).toEqual([{ column: 'tags', labels: ['Blocked'] }]);
  });
});

it('clears a rectangle in one uniform row operation', () => {
  const result = mutationOp(
    'table',
    { kind: 'clear', rowIds: ['one', 'two'], columnIds: ['name', 'count'] },
    () => ok(column('STRING'))
  );
  expect(result._unsafeUnwrap()).toEqual({
    kind: 'rows',
    table: 'table',
    change: {
      kind: 'update',
      changes: {
        kind: 'uniform',
        rows: ['one', 'two'],
        cells: [
          { column: 'name', value: { type: 'clear' } },
          { column: 'count', value: { type: 'clear' } },
        ],
      },
    },
  });
});
