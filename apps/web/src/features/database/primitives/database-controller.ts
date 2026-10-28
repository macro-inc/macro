import type { DatabaseOp } from '@core/database-sql/generated/types';
import { errAsync, ok, ResultAsync } from 'neverthrow';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
} from 'solid-js';
import { v7 as uuidv7 } from 'uuid';
import type { FormulaEditing } from '../context/formula-editing';
import type { OptionEditing } from '../context/option-editing';
import type { DatabaseApi, DatabaseCapabilities } from '../core/api';
import { mergeDatabaseColumnOrder } from '../core/column-order';
import type {
  CreateDatabaseColumn,
  DatabaseColumnTypeChange,
  DatabaseSchemaChange,
} from '../core/column-schema';
import type { DatabaseViewColumn } from '../core/database-view';
import { defaultDatabaseColumnName } from '../core/property-creation';
import type { DatabaseDataSource } from '../queries/api-source';

/** Shared schema actions. The API owns persistence; the source owns refresh. */
export function createDatabaseController(args: {
  api: DatabaseApi;
  data: DatabaseDataSource;
  tableId: string;
  capabilities: Accessor<DatabaseCapabilities>;
  inferNewColumns?: boolean;
}) {
  const { api, data, tableId } = args;
  const [createdColumns, setCreatedColumns] = createSignal<
    DatabaseViewColumn[]
  >([]);
  const creating = new Map<string, DatabaseSchemaChange<string>>();
  const columns = createMemo(() => {
    const read = data.rows.columns();
    const added = createdColumns().filter(
      (column) => !read.some((received) => received.id === column.id)
    );
    return added.length ? [...read, ...added] : read;
  });
  // Drop local previews once the external schema acknowledges them, so a
  // subsequent deletion cannot resurrect a column from the preview.
  createEffect(
    on(data.rows.columns, (received) => {
      setCreatedColumns((columns) =>
        columns.filter(
          (column) => !received.some((read) => read.id === column.id)
        )
      );
    })
  );
  const ready = () =>
    ResultAsync.combine([...creating.values()]).map(() => undefined);
  const shownData: DatabaseDataSource = {
    table: () => {
      const table = data.table();
      return table ? { ...table, columns: columns() } : undefined;
    },
    rows: {
      ...data.rows,
      columns,
      write: (mutation, baseVersion, createOptions) => {
        const waitingForColumn = creating.size > 0;
        return ready()
          .mapErr((error) => ({ kind: 'ops' as const, error }))
          .andThen(() =>
            data.rows.write(
              mutation,
              waitingForColumn
                ? (data.table()?.version ?? baseVersion)
                : baseVersion,
              createOptions
            )
          );
      },
      addOption: (columnId, label) =>
        ready().andThen(() => data.rows.addOption(columnId, label)),
    },
  };
  const apply = (ops: DatabaseOp[], baseVersion?: number) =>
    api
      .applyOps({
        ops,
        ...(baseVersion === undefined
          ? {}
          : { baseVersions: { [tableId]: baseVersion } }),
      })
      .andThen((applied) =>
        data.rows
          .refresh('after-write')
          .orElse(() => ok(undefined))
          .map(() => applied)
      );
  const schemaApply: typeof apply = (ops, version) =>
    args.capabilities().editColumns
      ? ready().andThen(() => apply(ops, version))
      : errAsync({
          code: 'FORBIDDEN',
          refusal: null,
          message: 'You cannot edit columns.',
        });
  const change = (
    column: string,
    change: Extract<DatabaseOp, { kind: 'column' }>['change'],
    version?: number
  ) =>
    schemaApply(
      [{ kind: 'column', table: tableId, column, change }],
      version
    ).map(() => undefined);
  const schemaEditing = {
    createDefaultColumn: ((onCreated?: (columnId: string) => void) => {
      if (!args.capabilities().editColumns)
        return errAsync({
          code: 'FORBIDDEN',
          refusal: null,
          message: 'You cannot edit columns.',
        });
      const column = uuidv7();
      const name = defaultDatabaseColumnName(
        columns().map((column) => column.name)
      );
      const inferType = args.inferNewColumns ?? false;
      setCreatedColumns((columns) => [
        ...columns,
        {
          id: column,
          name,
          dataType: 'STRING',
          writable: true,
          isMultiSelect: false,
          options: [],
          inferType,
        },
      ]);
      const created = change(column, {
        kind: 'create',
        definition: {
          source: 'new',
          name,
          type: { type: 'text' },
          inferType,
        },
      })
        .map(() => {
          creating.delete(column);
          return column;
        })
        .mapErr((error) => {
          creating.delete(column);
          setCreatedColumns((columns) =>
            columns.filter((current) => current.id !== column)
          );
          return error;
        });
      creating.set(column, created);
      onCreated?.(column);
      return created;
    }) satisfies CreateDatabaseColumn,
    rename: (column: string, name: string, previousName: string) =>
      change(column, { kind: 'rename', name, previousName }),
    remove: (column: string) =>
      change(column, { kind: 'delete' }, data.table()?.version),
    reorder: (columns: string[]) =>
      schemaApply(
        [
          {
            kind: 'table',
            table: tableId,
            change: {
              kind: 'reorder_columns',
              order: mergeDatabaseColumnOrder(
                data.rows.columns().map((column) => column.id),
                columns
              ),
            },
          },
        ],
        data.table()?.version
      ).map(() => undefined),
    changeType: (column: string, request: DatabaseColumnTypeChange) => {
      const table = data.table();
      if (!table)
        return errAsync({
          code: 'NOT_FOUND' as const,
          refusal: null,
          message: 'This table is unavailable.',
        });
      const to =
        request.to.type === 'relation'
          ? { ...request.to, database: table.databaseId }
          : request.to;
      return change(
        column,
        { kind: 'change_type', to },
        request.baseVersion ?? table.version
      );
    },
  };
  const formulaEditing: FormulaEditing = {
    tableId,
    columns: () => data.table()?.columns ?? [],
    setFormula: (column, formula) =>
      change(column, { kind: 'set_formula', formula }),
    createFormulaColumn: ({ name, formula, beside, replace }) => {
      const column = uuidv7();
      const create: DatabaseOp = {
        kind: 'column',
        table: tableId,
        column,
        change: {
          kind: 'create',
          definition: { source: 'derived', name, formula },
          ...(replace ? {} : { after: beside }),
        },
      };
      const ops: DatabaseOp[] = replace
        ? [
            {
              kind: 'column',
              table: tableId,
              column: beside,
              change: { kind: 'delete' },
            },
            create,
            {
              kind: 'table',
              table: tableId,
              change: {
                kind: 'reorder_columns',
                order: (data.table()?.columns ?? []).map((existing) =>
                  existing.id === beside ? column : existing.id
                ),
              },
            },
          ]
        : [create];
      return schemaApply(ops, data.table()?.version).map(() => column);
    },
  };
  const optionEditing: OptionEditing = {
    update: (column, option, request) =>
      change(column, { kind: 'update_option', option, ...request }).mapErr(
        (error) => ({ kind: 'ops', error })
      ),
    remove: (column, option) =>
      change(column, { kind: 'delete_option', option }).mapErr((error) => ({
        kind: 'ops',
        error,
      })),
  };
  return {
    data: shownData,
    optionEditing: () =>
      args.capabilities().editColumns ? optionEditing : undefined,
    formulaEditing: () =>
      args.capabilities().editColumns ? formulaEditing : undefined,
    capabilities: args.capabilities,
    apply,
    schemaEditing: () =>
      args.capabilities().editColumns ? schemaEditing : undefined,
  };
}
export type DatabaseController = ReturnType<typeof createDatabaseController>;
