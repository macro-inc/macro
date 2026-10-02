/** Relabelling, recolouring and removing a select column's options, shown at once wherever its definition is bound. */
import { optionColorOf } from '@property/tags/tagColors';
import { queryClient } from '@queries/client';
import { databasesKeys } from '@queries/storage/keys';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { PropertyOption } from '@service-storage/generated/schemas/propertyOption';
import { err, errAsync, ok, type Result, ResultAsync } from 'neverthrow';
import type { OptionChange } from '../context/option-editing';
import { inferDatabaseNumber } from '../core/column-inference';
import type { DatabaseOpFailure } from '../core/write-failure';
import { applyOp, patchDetail } from './detail-cache';

type OptionTarget = {
  databaseId: string;
  tableId: string;
  columnId: string;
  optionId: string;
};

function definitionOf(
  detail: DatabaseDetail,
  { tableId, columnId }: OptionTarget
): string | undefined {
  return detail.tables
    .find((table) => table.table.id === tableId)
    ?.columns.find((column) => column.column.id === columnId)?.definition
    .definition.id;
}

/** Every column bound to the target's definition, with its options changed. */
function patchOptions(
  target: OptionTarget,
  change: (options: PropertyOption[]) => PropertyOption[]
): Promise<void> {
  return patchDetail(target.databaseId, (detail) => {
    const definition = definitionOf(detail, target);
    return {
      ...detail,
      tables: detail.tables.map((table) => ({
        ...table,
        columns: table.columns.map((column) =>
          column.definition.definition.id === definition
            ? {
                ...column,
                definition: {
                  ...column.definition,
                  property_options: change(column.definition.property_options),
                },
              }
            : column
        ),
      })),
    };
  });
}

/** The option as the change leaves it, or why the change cannot be made. */
function changed(
  option: PropertyOption,
  change: OptionChange
): Result<PropertyOption, DatabaseOpFailure> {
  const swatch =
    change.color === undefined ? undefined : optionColorOf(change.color);
  if (change.color !== undefined && !swatch)
    return err({ kind: 'unknown-color' });
  const color = swatch?.color ?? option.color;
  if (change.label === undefined) return ok({ ...option, color });
  if (option.value.type === 'number') {
    const number = inferDatabaseNumber(change.label);
    return number === undefined
      ? err({ kind: 'not-a-number' })
      : ok({ ...option, color, value: { type: 'number', value: number } });
  }
  return ok({
    ...option,
    color,
    value: { type: option.value.type, value: change.label },
  });
}

/** The cached option the target names. */
function cachedOption(target: OptionTarget): PropertyOption | undefined {
  return queryClient
    .getQueryData<DatabaseDetail>(
      databasesKeys.detail(target.databaseId).queryKey
    )
    ?.tables.find((table) => table.table.id === target.tableId)
    ?.columns.find((column) => column.column.id === target.columnId)
    ?.definition.property_options.find(
      (option) => option.id === target.optionId
    );
}

export function updateDatabaseOption(
  target: OptionTarget,
  change: OptionChange
): ResultAsync<void, DatabaseOpFailure> {
  const option = cachedOption(target);
  const shown = option ? changed(option, change) : ok(undefined);
  if (shown.isErr()) return errAsync(shown.error);
  const patched = shown.value;
  return ResultAsync.fromSafePromise(
    patched
      ? patchOptions(target, (options) =>
          options.map((existing) =>
            existing.id === target.optionId ? patched : existing
          )
        )
      : Promise.resolve()
  )
    .andThen(() =>
      applyOp(
        target.databaseId,
        target.tableId,
        {
          kind: 'column',
          table: target.tableId,
          column: target.columnId,
          change: { kind: 'update_option', option: target.optionId, ...change },
        },
        { kind: 'column', change: 'option_updated' }
      )
    )
    .map(() => undefined);
}

/** Remove an option; the cells holding it are emptied of it on the server. */
export function deleteDatabaseOption(
  target: OptionTarget
): ResultAsync<void, DatabaseOpFailure> {
  return ResultAsync.fromSafePromise(
    patchOptions(target, (options) =>
      options.filter((option) => option.id !== target.optionId)
    )
  )
    .andThen(() =>
      applyOp(
        target.databaseId,
        target.tableId,
        {
          kind: 'column',
          table: target.tableId,
          column: target.columnId,
          change: { kind: 'delete_option', option: target.optionId },
        },
        { kind: 'column', change: 'option_deleted' }
      )
    )
    .map(() => undefined);
}
