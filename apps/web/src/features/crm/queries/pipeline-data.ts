import type { ColumnDetail } from '@service-storage/generated/schemas/columnDetail';
import type { PropertyValue } from '@service-storage/generated/schemas/propertyValue';
import { err, errAsync, ok, ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import type { DatabaseApi } from '../../database/core/api';
import type { DatabaseCellValue } from '../../database/core/database-view';
import { UNAVAILABLE_OPTION } from '../../database/core/grid-cells';
import { toViewColumn } from '../../database/queries/column-detail';
import type { Pipeline } from '../core/pipeline';
import type { CrmRecordDependencies } from './dependencies';

/** Adapt stored properties to the shared editor's values. */
export function pipelineCell(
  value: PropertyValue | undefined,
  column: ColumnDetail
): DatabaseCellValue {
  if (!value) return null;
  const listed = (values: string[]) =>
    column.definition.definition.is_multi_select
      ? JSON.stringify(values)
      : (values[0] ?? null);
  return match(value)
    .with({ type: 'Boolean' }, ({ value }) => (value ? 1 : 0))
    .with(
      { type: 'Number' },
      { type: 'String' },
      { type: 'Date' },
      ({ value }) => value
    )
    .with({ type: 'Link' }, ({ value }) => listed(value))
    .with({ type: 'EntityReference' }, ({ value }) =>
      listed(value.map((ref) => ref.entity_id))
    )
    .with({ type: 'SelectOption' }, ({ value }) =>
      listed(
        value.map((id) => {
          const option = column.definition.property_options.find(
            (option) => option.id === id
          );
          return option ? String(option.value.value) : UNAVAILABLE_OPTION;
        })
      )
    )
    .exhaustive();
}

/** Transport adapter only; the shared provider owns queries and editing. */
export function createPipelineApi(
  storage: Pick<
    CrmRecordDependencies['storage'],
    'getCrmPipelineTable' | 'queryCrmPipelineRows' | 'applyCrmPipelineOps'
  >,
  pipeline: Pipeline
): DatabaseApi {
  const failure = () => ({
    kind: 'fetch' as const,
    message: 'Could not read this pipeline.',
  });
  const table = () =>
    new ResultAsync(storage.getCrmPipelineTable(pipeline.id)).mapErr(failure);
  return {
    key: ['crm', 'pipeline', pipeline.id],
    readTable: (tableId) =>
      tableId !== pipeline.tableId
        ? errAsync(failure())
        : table().map((detail) => ({
            id: detail.table.id,
            databaseId: detail.table.database_id,
            name: pipeline.name,
            version: detail.table.version,
            columns: detail.columns.map((column) => ({
              ...toViewColumn(column),
              primary: column.column.id === pipeline.primaryColumnId,
            })),
          })),
    readRows: (request) =>
      request.tableId !== pipeline.tableId
        ? errAsync(failure())
        : table().andThen((schema) =>
            new ResultAsync(
              storage.queryCrmPipelineRows(pipeline.id, {
                after: request.cursor,
                query: {
                  ...request.query,
                  filter: request.query.filter ?? null,
                },
                rowIds: request.rowIds,
              })
            )
              .mapErr(failure)
              .andThen((page) => {
                if (page.version !== schema.table.version)
                  return err(failure());
                return ok({
                  tableVersion: page.version,
                  nextCursor: page.next ?? undefined,
                  rows: page.rows.map((row) => ({
                    rowId: row.rowId,
                    cells: Object.fromEntries(
                      schema.columns.map((column) => [
                        column.column.id,
                        pipelineCell(row.cells[column.column.id], column),
                      ])
                    ),
                  })),
                });
              })
          ),
    applyOps: (batch) =>
      storage
        .applyCrmPipelineOps(pipeline.id, batch)
        .mapErr(([error]) => error),
  };
}
