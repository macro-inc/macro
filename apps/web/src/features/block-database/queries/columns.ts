/** Adding columns and options under ids minted here, refreshing the cached schema once they land. */
import type {
  DatabaseOp,
  OpColumnKind,
} from '@core/database-sql/generated/types';
import { applyDatabaseOps } from '@queries/storage/databases';
import { storageServiceClient } from '@service-storage/client';
import { v7 as uuidv7 } from 'uuid';
import type {
  DatabaseColumnKind,
  DatabaseSchemaChange,
} from '../../database/core/column-schema';
import { opColumnKind } from './column-schema';

/**
 * Add a column at the table's end and return its id. A select column's
 * options go in the same op, each under its own id.
 */
export function createDatabaseColumn(params: {
  databaseId: string;
  tableId: string;
  name: string;
  type: OpColumnKind;
  options?: string[];
  /** Let the column's first value settle its type: only for plain text. */
  inferType?: boolean;
}): DatabaseSchemaChange<string> {
  const id = uuidv7();
  return applyDatabaseOps(params.databaseId, [
    {
      kind: 'column',
      table: params.tableId,
      column: id,
      change: {
        kind: 'create',
        definition: {
          source: 'new',
          name: params.name,
          type: params.type,
          ...(params.options && {
            options: params.options.map((label) => ({ id: uuidv7(), label })),
          }),
          ...(params.inferType && { inferType: true }),
        },
      },
    },
  ]).map(() => id);
}

/** Add select options to a column; labels it already has are left out. */
export function addDatabaseColumnOptions(params: {
  databaseId: string;
  tableId: string;
  columnId: string;
  labels: string[];
}): DatabaseSchemaChange {
  return applyDatabaseOps(params.databaseId, [
    {
      kind: 'column',
      table: params.tableId,
      column: params.columnId,
      change: {
        kind: 'add_options',
        options: params.labels.map((label) => ({ id: uuidv7(), label })),
      },
    },
  ]).map(() => undefined);
}

/**
 * Add a column of type `to` right after `columnId`, holding the values of
 * that column that convert; the column itself is left as it is. One batch,
 * against the table version the conversion was read at. Answers the new
 * column's id.
 */
export function convertDatabaseColumn(params: {
  databaseId: string;
  tableId: string;
  columnId: string;
  to: DatabaseColumnKind;
  name: string;
}): DatabaseSchemaChange<string> {
  const table = params.tableId;
  const type = opColumnKind(params.databaseId, params.to);
  return storageServiceClient.databases
    .convertColumn({
      id: params.databaseId,
      tableId: table,
      columnId: params.columnId,
      to: type,
    })
    .mapErr(([error]) => error)
    .andThen((conversion) => {
      const id = uuidv7();
      const ops: DatabaseOp[] = [
        {
          kind: 'column',
          table,
          column: id,
          change: {
            kind: 'create',
            definition: {
              source: 'new',
              name: params.name,
              type,
              options: conversion.options.map((label) => ({
                id: uuidv7(),
                label,
              })),
            },
            after: params.columnId,
          },
        },
      ];
      if (conversion.cells.length)
        ops.push({
          kind: 'rows',
          table,
          change: {
            kind: 'update',
            changes: {
              kind: 'per_row',
              rows: conversion.cells.map(({ row, value }) => ({
                row,
                cells: [{ column: id, value }],
              })),
            },
          },
        });
      return applyDatabaseOps(params.databaseId, ops, {
        [table]: conversion.tableVersion,
      }).map(() => id);
    });
}
