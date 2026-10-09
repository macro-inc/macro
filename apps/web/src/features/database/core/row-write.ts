import type { DatabaseOp } from '@core/database-sql/generated/types';
import { err, ok, ResultAsync } from 'neverthrow';
import { v7 as uuidv7 } from 'uuid';
import type { DatabaseApi } from './api';
import { missingOptionLabels, mutationOp } from './cell-ops';
import type { DatabaseViewColumn } from './database-view';
import type { DatabaseRowMutation } from './table';
import type { DatabaseWriteFailure } from './write-failure';

/** One row mutation and any new select options are committed together. */
export function writeDatabaseRow(
  args: {
    tableId: string;
    columns: readonly DatabaseViewColumn[];
    applyOps: DatabaseApi['applyOps'];
  },
  mutation: DatabaseRowMutation,
  createOptions: boolean
): ResultAsync<
  {
    insertedRowIds: string[];
    version: number;
  },
  DatabaseWriteFailure
> {
  const op = mutationOp(args.tableId, mutation, (id) => {
    const column = args.columns.find((column) => column.id === id);
    return column?.writable
      ? ok(column)
      : err({ kind: 'read-only-column' as const });
  });
  if (op.isErr()) return new ResultAsync(Promise.resolve(err(op.error)));
  const options: DatabaseOp[] = createOptions
    ? missingOptionLabels(
        op.value,
        (id) =>
          args.columns
            .find((column) => column.id === id)
            ?.options.map((option) => option.label) ?? []
      ).map(({ column, labels }) => ({
        kind: 'column',
        table: args.tableId,
        column,
        change: {
          kind: 'add_options',
          options: labels.map((label) => ({ id: uuidv7(), label })),
        },
      }))
    : [];
  return args
    .applyOps({ ops: [...options, op.value] })
    .mapErr((error): DatabaseWriteFailure => {
      const refused = [
        'INVALID_OP',
        'UNAUTHORIZED',
        'FORBIDDEN',
        'NOT_FOUND',
        'CONFLICT',
        'GONE',
      ].includes(error.code);
      return mutation.kind === 'create' && !refused
        ? { kind: 'outcome-unknown' }
        : { kind: 'ops', error };
    })
    .andThen((applied) => {
      const result = applied.results.at(-1);
      return result?.kind === 'rows'
        ? ok({
            insertedRowIds:
              result.change.kind === 'inserted' ? result.change.rows : [],
            version: result.tableVersion,
          })
        : err({ kind: 'unexpected-result' as const });
    });
}
