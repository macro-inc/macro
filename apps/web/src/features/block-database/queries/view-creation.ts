import { queryClient } from '@queries/client';
import { databaseDetailQueryOptions } from '@queries/storage/databases';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import type { ViewLayout } from '@service-storage/generated/schemas/viewLayout';
import { okAsync, ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import { v7 as uuidv7 } from 'uuid';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import {
  type NewView,
  newViewNeedsColumn,
  type ViewCreation,
} from '../../database/core/view-creation';
import { boardLayout, timelineLayout } from '../../database/core/views';
import type { DatabaseOpFailure } from '../../database/core/write-failure';
import {
  createBoardWithStatusColumn,
  createDatabaseView,
  createTimelineWithTimeRangeColumn,
} from './views';

/** Mint the whole intent once. A retry checks for a committed view before writing again. */
export function prepareViewCreation(
  current: DatabaseView,
  input: NewView,
  columns: DatabaseViewColumn[]
): ViewCreation {
  const id = uuidv7();
  const status = {
    column: uuidv7(),
    options: [uuidv7(), uuidv7(), uuidv7()] as [string, string, string],
  };
  const dates = uuidv7();
  const needsColumn = newViewNeedsColumn(input);
  const layout = match(input)
    .returnType<ViewLayout>()
    .with({ layout: 'table' }, () =>
      current.layout.kind === 'table'
        ? current.layout
        : { kind: 'table', columns: [] }
    )
    .with({ layout: 'board' }, ({ groupBy }) =>
      boardLayout(
        groupBy.kind === 'column' ? groupBy.columnId : status.column,
        columns
      )
    )
    .with({ layout: 'timeline' }, ({ range }) =>
      timelineLayout(range.kind === 'column' ? range.columnId : dates, columns)
    )
    .exhaustive((): ViewLayout => ({ kind: 'table', columns: [] }));
  const view: DatabaseView = {
    ...current,
    id,
    name: input.name,
    layout,
    position: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let attempted = false;
  const write = () => {
    if (!needsColumn)
      return createDatabaseView(
        current.databaseId,
        current.tableId,
        { name: input.name, query: current.query, layout },
        id
      );
    const created = {
      databaseId: current.databaseId,
      tableId: current.tableId,
      name: input.name,
      query: current.query,
      columns,
      viewId: id,
    };
    return input.layout === 'timeline'
      ? createTimelineWithTimeRangeColumn({ ...created, column: dates })
      : createBoardWithStatusColumn({ ...created, status });
  };
  return {
    view,
    needsColumn,
    save: () => {
      if (!attempted) {
        attempted = true;
        return write();
      }
      return ResultAsync.fromPromise(
        queryClient.fetchQuery({
          ...databaseDetailQueryOptions(current.databaseId),
          staleTime: 0,
        }),
        (): DatabaseOpFailure => ({
          kind: 'ops',
          error: {
            code: 'NETWORK_ERROR',
            message: 'Could not check whether the view was saved. Try again.',
            refusal: null,
          },
        })
      ).andThen((detail) => {
        const existing = detail.tables
          .flatMap((table) => table.views)
          .find((view) => view.id === id);
        return existing ? okAsync(existing) : write();
      });
    },
  };
}
