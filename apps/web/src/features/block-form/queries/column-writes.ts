/**
 * A form's column facts, written as the grid writes them: typed ops on
 * `POST /databases/{id}/ops`. The forms service never proxies schema edits.
 */

import {
  columnSchemaMessage,
  type DatabaseColumnKind,
} from '@block-database/core/column-schema';
import { convertDatabaseColumn } from '@block-database/queries/columns';
import type {
  DatabaseOp,
  OpColumnKind,
} from '@core/database-sql/generated/types';
import { applyDatabaseOps } from '@queries/storage/databases';
import type { DatabaseOpsError } from '@service-storage/databases';
import type { ResultAsync } from 'neverthrow';
import type {
  FormColumnWrites,
  FormWriteFailure,
} from '../context/form-context';
import type { FormColumnKind } from '../core/form-model';

/** What the builder says when the database refused a column write: the grid's words. */
export function columnWriteFailure(error: DatabaseOpsError): FormWriteFailure {
  return { message: columnSchemaMessage(error) };
}

/** A form's kind as the grid converts to it; a relation's rows live in the form's database. */
function databaseKind(kind: FormColumnKind): DatabaseColumnKind {
  return kind.type === 'relation'
    ? { type: 'relation', table: kind.table }
    : kind;
}

const opKind = (kind: FormColumnKind): OpColumnKind => kind;

export function createColumnWrites(
  databaseId: string,
  tableId: string
): FormColumnWrites {
  const apply = (ops: DatabaseOp[]): ResultAsync<void, FormWriteFailure> =>
    applyDatabaseOps(databaseId, ops)
      .map(() => undefined)
      .mapErr(columnWriteFailure);
  const column = (
    columnId: string,
    change: Extract<DatabaseOp, { kind: 'column' }>['change']
  ): DatabaseOp => ({
    kind: 'column',
    table: tableId,
    column: columnId,
    change,
  });

  return {
    create: (created) =>
      apply([
        column(created.id, {
          kind: 'create',
          definition: {
            source: 'new',
            name: created.name,
            type: opKind(created.kind),
            ...(created.options.length > 0 && { options: created.options }),
          },
        }),
      ]),
    rename: (columnId, name, previousName) =>
      apply([column(columnId, { kind: 'rename', name, previousName })]),
    changeType: (columnId, to) =>
      apply([column(columnId, { kind: 'change_type', to: opKind(to) })]),
    addOptions: (columnId, options) =>
      apply([column(columnId, { kind: 'add_options', options })]),
    updateOption: (columnId, optionId, change) =>
      apply([
        column(columnId, {
          kind: 'update_option',
          option: optionId,
          ...(change.label !== undefined && { label: change.label }),
          ...(change.color !== undefined && { color: change.color }),
        }),
      ]),
    deleteOption: (columnId, optionId) =>
      apply([column(columnId, { kind: 'delete_option', option: optionId })]),
    remove: (columnId) => apply([column(columnId, { kind: 'delete' })]),
    // The grid's conversion flow (RFC 02 §3): a new column beside this one.
    convert: (columnId, to, name) =>
      convertDatabaseColumn({
        databaseId,
        tableId,
        columnId,
        to: databaseKind(to),
        name,
      }).mapErr(columnWriteFailure),
  };
}
