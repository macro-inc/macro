/** A table's typed views and a board's card places, written as ops and shown in the cached detail ahead of the answer. */

import type { DatabaseOp } from '@core/database-sql/generated/types';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import {
  applyDatabaseOps,
  invalidateDatabase,
} from '@queries/storage/databases';
import { storageServiceClient } from '@service-storage/client';
import type { CardPosition } from '@service-storage/generated/schemas/cardPosition';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import type { NewView } from '@service-storage/generated/schemas/newView';
import type { ViewLayout } from '@service-storage/generated/schemas/viewLayout';
import type { ViewQuery } from '@service-storage/generated/schemas/viewQuery';
import { useQuery } from '@tanstack/solid-query';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { v7 as uuidv7 } from 'uuid';
import {
  boardWithStatusColumn,
  type MintedStatusColumn,
  newBoardWithStatusColumn,
} from '../core/board-grouping';
import type { CardMove } from '../core/board-moves';
import type { DatabaseViewColumn } from '../core/database-view';
import { createKeyedSerializer } from '../core/keyed-serializer';
import type { DatabaseOpFailure } from '../core/write-failure';
import { applyOp, isResult, patchViews } from './detail-cache';
import { databaseViewKeys } from './keys';

const writes = createKeyedSerializer();

/** A view's writes, or a table's view-list writes, reach the server in the order they were made. */
function inOrder<Value>(
  key: string,
  write: () => ResultAsync<Value, DatabaseOpFailure>
): ResultAsync<Value, DatabaseOpFailure> {
  return new ResultAsync(writes.run(key, async () => await write()));
}

const viewListKey = (tableId: string) => `table:${tableId}`;

/** The latest change made to each view whose answer is outstanding. */
const latestChanges = new Map<string, number>();
let changeSequence = 0;

/** Add a view under an id minted here, which `viewId` may name ahead of the answer. */
export function createDatabaseView(
  databaseId: string,
  tableId: string,
  view: NewView,
  viewId: string = uuidv7()
): ResultAsync<DatabaseView, DatabaseOpFailure> {
  return inOrder(viewListKey(tableId), () =>
    applyOp(
      databaseId,
      {
        kind: 'view',
        table: tableId,
        view: viewId,
        change: { kind: 'create', view },
      },
      { kind: 'view', change: 'created' }
    )
  ).map(async ({ change: { view: created } }) => {
    await patchViews(databaseId, tableId, (views) => [
      ...views.filter((existing) => existing.id !== created.id),
      created,
    ]);
    return created;
  });
}

/** Ids for a new Status column and its options, minted here. */
function mintStatusColumn(): MintedStatusColumn {
  return { column: uuidv7(), options: [uuidv7(), uuidv7(), uuidv7()] };
}

/**
 * Apply a batch that adds a column and then creates or changes a view, as
 * one write. The answered view replaces or joins the cached views, and the
 * detail is read again for the column.
 */
function applyColumnAndView(
  databaseId: string,
  tableId: string,
  orderKey: string,
  ops: DatabaseOp[]
): ResultAsync<DatabaseView, DatabaseOpFailure> {
  return inOrder(orderKey, () =>
    applyDatabaseOps(databaseId, ops)
      .mapErr((error): DatabaseOpFailure => ({ kind: 'ops', error }))
      .andThen((results) => {
        const result = results.at(-1);
        if (
          !isResult(result, 'view', 'created') &&
          !isResult(result, 'view', 'updated')
        )
          return errAsync<DatabaseView, DatabaseOpFailure>({
            kind: 'unexpected-result',
          });
        return okAsync(result.change.view);
      })
      .orElse((failure) => {
        void invalidateDatabase(databaseId);
        return errAsync(failure);
      })
  ).map(async (view) => {
    await patchViews(databaseId, tableId, (views) =>
      views.some((existing) => existing.id === view.id)
        ? views.map((existing) => (existing.id === view.id ? view : existing))
        : [...views, view]
    );
    return view;
  });
}

/** Add a board grouped by a new Status column, the column and the board in one batch. */
export function createBoardWithStatusColumn(params: {
  databaseId: string;
  tableId: string;
  name: string;
  query: ViewQuery;
  columns: readonly DatabaseViewColumn[];
  viewId?: string;
  status?: MintedStatusColumn;
}): ResultAsync<DatabaseView, DatabaseOpFailure> {
  return applyColumnAndView(
    params.databaseId,
    params.tableId,
    viewListKey(params.tableId),
    newBoardWithStatusColumn({
      tableId: params.tableId,
      viewId: params.viewId ?? uuidv7(),
      name: params.name,
      query: params.query,
      columns: params.columns,
      status: params.status ?? mintStatusColumn(),
    })
  );
}

/** Lay a view out as a board grouped by a new Status column, the column and the change in one batch. */
export function showAsBoardWithStatusColumn(
  view: DatabaseView,
  columns: readonly DatabaseViewColumn[]
): ResultAsync<DatabaseView, DatabaseOpFailure> {
  return applyColumnAndView(
    view.databaseId,
    view.tableId,
    view.id,
    boardWithStatusColumn({ view, columns, status: mintStatusColumn() })
  );
}

export type ViewChange = {
  name?: string;
  query?: ViewQuery;
  layout?: ViewLayout;
};

/** Change a view; a later change made before this one answers keeps its place. */
export function updateDatabaseView(
  view: DatabaseView,
  change: ViewChange
): ResultAsync<DatabaseView, DatabaseOpFailure> {
  const sequence = ++changeSequence;
  latestChanges.set(view.id, sequence);
  const isLatest = () => latestChanges.get(view.id) === sequence;
  const settle = () => {
    if (isLatest()) latestChanges.delete(view.id);
  };
  // Reserve the view's queue position before the asynchronous cache patch.
  // A following card move must not overtake the sort removal it depends on.
  const optimistic = ResultAsync.fromSafePromise(
    patchViews(view.databaseId, view.tableId, (views) =>
      views.map((existing) =>
        existing.id === view.id ? { ...existing, ...change } : existing
      )
    )
  );
  return inOrder(view.id, () =>
    optimistic.andThen(() =>
      applyOp(
        view.databaseId,
        {
          kind: 'view',
          table: view.tableId,
          view: view.id,
          change: { kind: 'update', ...change },
        },
        { kind: 'view', change: 'updated' }
      )
    )
  )
    .map(async ({ change: { view: stored } }) => {
      if (isLatest())
        await patchViews(view.databaseId, view.tableId, (views) =>
          views.map((existing) =>
            existing.id === stored.id ? stored : existing
          )
        );
      settle();
      return stored;
    })
    .mapErr((failure) => {
      settle();
      return failure;
    });
}

export function deleteDatabaseView(
  view: DatabaseView
): ResultAsync<void, DatabaseOpFailure> {
  return ResultAsync.fromSafePromise(
    patchViews(view.databaseId, view.tableId, (views) =>
      views.filter((existing) => existing.id !== view.id)
    )
  )
    .andThen(() =>
      inOrder(view.id, () =>
        applyOp(
          view.databaseId,
          {
            kind: 'view',
            table: view.tableId,
            view: view.id,
            change: { kind: 'delete' },
          },
          { kind: 'view', change: 'deleted' }
        )
      )
    )
    .map(() => undefined);
}

/** Put a table's views in `order`, which names every one of them once. */
export function reorderDatabaseViews(
  databaseId: string,
  tableId: string,
  order: string[]
): ResultAsync<void, DatabaseOpFailure> {
  const ordered = (views: DatabaseView[]) =>
    order.flatMap((id) => views.filter((view) => view.id === id));
  return ResultAsync.fromSafePromise(patchViews(databaseId, tableId, ordered))
    .andThen(() =>
      inOrder(viewListKey(tableId), () =>
        applyOp(
          databaseId,
          {
            kind: 'table',
            table: tableId,
            change: { kind: 'reorder_views', order },
          },
          { kind: 'table', change: 'views_reordered' }
        )
      )
    )
    .map(async ({ change: { positions } }) => {
      await patchViews(databaseId, tableId, (views) =>
        ordered(views).map((view) => ({
          ...view,
          position:
            positions.find((entry) => entry.view === view.id)?.position ??
            view.position,
        }))
      );
    });
}

/** Where a board's cards sit, read again when its table changes. */
export function useCardPositions(
  databaseId: string,
  viewId: Accessor<string | undefined>
) {
  return useQuery(() => {
    const id = viewId();
    return {
      queryKey: databaseViewKeys.positions(databaseId, id ?? '').queryKey,
      queryFn: async () => {
        const { positions } = await throwOnErr(() =>
          storageServiceClient.databases.viewPositions({
            id: databaseId,
            viewId: id ?? '',
          })
        );
        return positions;
      },
      enabled: !!id,
    };
  });
}

export function setCardPositions(
  databaseId: string,
  viewId: string,
  change: (positions: CardPosition[]) => CardPosition[]
) {
  queryClient.setQueryData<CardPosition[]>(
    databaseViewKeys.positions(databaseId, viewId).queryKey,
    (previous) => change(previous ?? [])
  );
}

export function refreshCardPositions(databaseId: string, viewId: string) {
  return queryClient.invalidateQueries({
    queryKey: databaseViewKeys.positions(databaseId, viewId).queryKey,
  });
}

/** The places a card move wrote and the table version it left. */
export type CardMoved = { positions: CardPosition[]; tableVersion: number };

/**
 * Move a board's card, which also sets its row's grouping cell. The places
 * the server wrote replace the ones shown ahead of its answer.
 */
export function moveDatabaseCard(
  view: DatabaseView,
  move: CardMove
): ResultAsync<CardMoved, DatabaseOpFailure> {
  return inOrder(view.id, () =>
    applyOp(
      view.databaseId,
      {
        kind: 'view',
        table: view.tableId,
        view: view.id,
        change: {
          kind: 'move_card',
          row: move.row,
          lane: move.lane,
          before: move.before,
          after: move.after,
        },
      },
      { kind: 'view', change: 'card_moved' }
    )
  )
    .map(({ change: { positions }, tableVersion }) => ({
      positions,
      tableVersion,
    }))
    .mapErr((failure) => {
      void refreshCardPositions(view.databaseId, view.id);
      return failure;
    });
}
