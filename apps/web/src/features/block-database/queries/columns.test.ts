import type { NewOption } from '@core/database-sql/generated/types';
import { okAsync } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDatabaseColumnOptions,
  convertDatabaseColumn,
  createDatabaseColumn,
} from './columns';

const storage = vi.hoisted(() => ({
  applyDatabaseOps: vi.fn(),
  invalidateDatabase: vi.fn(),
}));
vi.mock('@queries/storage/databases', () => storage);
const client = vi.hoisted(() => ({ convertColumn: vi.fn() }));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { databases: client },
}));

const uuidv7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.resetAllMocks();
});

describe('adding columns and options', () => {
  it('creates a select column with its options, each under a minted id, in one column create op', async () => {
    storage.applyDatabaseOps.mockReturnValue(
      okAsync([
        {
          kind: 'column',
          table: 'tasks',
          column: 'status',
          tableVersion: 3,
          change: { kind: 'created' },
        },
      ])
    );

    const created = await createDatabaseColumn({
      databaseId: 'db',
      tableId: 'tasks',
      name: 'Status',
      type: { type: 'select', multi: false },
      options: ['Todo', 'Done'],
    });

    expect(storage.applyDatabaseOps).toHaveBeenCalledExactlyOnceWith('db', [
      {
        kind: 'column',
        table: 'tasks',
        column: expect.stringMatching(uuidv7),
        change: {
          kind: 'create',
          definition: {
            source: 'new',
            name: 'Status',
            type: { type: 'select', multi: false },
            options: [
              { id: expect.stringMatching(uuidv7), label: 'Todo' },
              { id: expect.stringMatching(uuidv7), label: 'Done' },
            ],
          },
        },
      },
    ]);
    const [[, [op]]] = storage.applyDatabaseOps.mock.calls;
    const ids = [
      op.column,
      ...op.change.definition.options.map((option: NewOption) => option.id),
    ];
    expect(new Set(ids).size).toBe(3);
    expect(created._unsafeUnwrap()).toBe(op.column);
    expect(storage.invalidateDatabase).toHaveBeenCalledExactlyOnceWith('db');
  });

  it('adds options to a column under minted ids and reads the schema again', async () => {
    storage.applyDatabaseOps.mockReturnValue(
      okAsync([
        {
          kind: 'column',
          table: 'tasks',
          column: 'status',
          tableVersion: 4,
          change: { kind: 'options_added', added: ['done'] },
        },
      ])
    );

    const added = await addDatabaseColumnOptions({
      databaseId: 'db',
      tableId: 'tasks',
      columnId: 'status',
      labels: ['Done'],
    });

    expect(added.isOk()).toBe(true);
    expect(storage.applyDatabaseOps).toHaveBeenCalledExactlyOnceWith('db', [
      {
        kind: 'column',
        table: 'tasks',
        column: 'status',
        change: {
          kind: 'add_options',
          options: [{ id: expect.stringMatching(uuidv7), label: 'Done' }],
        },
      },
    ]);
    expect(storage.invalidateDatabase).toHaveBeenCalledExactlyOnceWith('db');
  });

  it('converts into a new column after the original in one batch, against the version the conversion read', async () => {
    client.convertColumn.mockReturnValue(
      okAsync({
        tableVersion: 6,
        options: ['High', 'Low'],
        cells: [
          {
            row: 'row-1',
            value: { type: 'options', value: [{ label: 'High' }] },
          },
          {
            row: 'row-2',
            value: { type: 'options', value: [{ label: 'Low' }] },
          },
        ],
        misfits: 2,
      })
    );
    storage.applyDatabaseOps.mockReturnValue(
      okAsync([
        {
          kind: 'column',
          table: 'tasks',
          column: 'new',
          tableVersion: 7,
          change: { kind: 'created' },
        },
        {
          kind: 'rows',
          table: 'tasks',
          tableVersion: 7,
          change: { kind: 'updated', affected: 2 },
        },
      ])
    );

    const converted = await convertDatabaseColumn({
      databaseId: 'db',
      tableId: 'tasks',
      columnId: 'priority',
      to: { type: 'select', multi: false },
      name: 'Priority (Select)',
    });

    expect(client.convertColumn).toHaveBeenCalledExactlyOnceWith({
      id: 'db',
      tableId: 'tasks',
      columnId: 'priority',
      to: { type: 'select', multi: false },
    });
    const [[, ops]] = storage.applyDatabaseOps.mock.calls;
    const [created] = ops;
    const [high, low] = created.change.definition.options;
    expect(storage.applyDatabaseOps).toHaveBeenCalledExactlyOnceWith(
      'db',
      [
        {
          kind: 'column',
          table: 'tasks',
          column: expect.stringMatching(uuidv7),
          change: {
            kind: 'create',
            definition: {
              source: 'new',
              name: 'Priority (Select)',
              type: { type: 'select', multi: false },
              options: [
                { id: expect.stringMatching(uuidv7), label: 'High' },
                { id: expect.stringMatching(uuidv7), label: 'Low' },
              ],
            },
            after: 'priority',
          },
        },
        {
          kind: 'rows',
          table: 'tasks',
          change: {
            kind: 'update',
            changes: {
              kind: 'per_row',
              rows: [
                {
                  row: 'row-1',
                  cells: [
                    {
                      column: created.column,
                      value: { type: 'options', value: [{ label: 'High' }] },
                    },
                  ],
                },
                {
                  row: 'row-2',
                  cells: [
                    {
                      column: created.column,
                      value: { type: 'options', value: [{ label: 'Low' }] },
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
      { tasks: 6 }
    );
    expect(new Set([created.column, high.id, low.id]).size).toBe(3);
    expect(converted._unsafeUnwrap()).toBe(created.column);
    expect(storage.invalidateDatabase).toHaveBeenCalledExactlyOnceWith('db');
  });

  it('creates only the new column when no value converts', async () => {
    client.convertColumn.mockReturnValue(
      okAsync({ tableVersion: 2, options: [], cells: [], misfits: 4 })
    );
    storage.applyDatabaseOps.mockReturnValue(
      okAsync([
        {
          kind: 'column',
          table: 'tasks',
          column: 'new',
          tableVersion: 3,
          change: { kind: 'created' },
        },
      ])
    );

    await convertDatabaseColumn({
      databaseId: 'db',
      tableId: 'tasks',
      columnId: 'owner',
      to: { type: 'relation', table: 'people' },
      name: 'Owner (People)',
    });

    expect(client.convertColumn).toHaveBeenCalledExactlyOnceWith({
      id: 'db',
      tableId: 'tasks',
      columnId: 'owner',
      to: { type: 'relation', database: 'db', table: 'people' },
    });
    expect(storage.applyDatabaseOps).toHaveBeenCalledExactlyOnceWith(
      'db',
      [
        {
          kind: 'column',
          table: 'tasks',
          column: expect.stringMatching(uuidv7),
          change: {
            kind: 'create',
            definition: {
              source: 'new',
              name: 'Owner (People)',
              type: { type: 'relation', database: 'db', table: 'people' },
              options: [],
            },
            after: 'owner',
          },
        },
      ],
      { tasks: 2 }
    );
  });
});
