import type { DatabaseOp } from '@core/database-sql/generated/types';
import { errAsync, ok } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { v7 as uuidv7 } from 'uuid';
import type { OptionEditing } from '../context/option-editing';
import type { DatabaseApi, DatabaseCapabilities } from '../core/api';
import { mergeDatabaseColumnOrder } from '../core/column-order';
import type { DatabaseColumnTypeChange } from '../core/column-schema';
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
      ? apply(ops, version)
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
    createDefaultColumn: () => {
      const column = uuidv7();
      return change(column, {
        kind: 'create',
        definition: {
          source: 'new',
          name: defaultDatabaseColumnName(
            data.rows.columns().map((column) => column.name)
          ),
          type: { type: 'text' },
          inferType: args.inferNewColumns ?? false,
        },
      }).map(() => column);
    },
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
    data,
    optionEditing: () =>
      args.capabilities().editColumns ? optionEditing : undefined,
    capabilities: args.capabilities,
    apply,
    schemaEditing: () =>
      args.capabilities().editColumns ? schemaEditing : undefined,
  };
}
export type DatabaseController = ReturnType<typeof createDatabaseController>;
