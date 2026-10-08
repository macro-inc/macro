import type { DatabaseOp } from '@core/database-sql/generated/types';
import { throwOnErr } from '@core/util/result';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import type { OpResult } from '@service-storage/generated/schemas/opResult';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { useQuery } from '@tanstack/solid-query';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { v7 as uuidv7 } from 'uuid';
import {
  boardWithStatusColumn,
  newBoardWithStatusColumn,
} from '../../database/core/board-grouping';
import type { CardMove } from '../../database/core/board-moves';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import { createKeyedSerializer } from '../../database/core/keyed-serializer';
import type { NewView } from '../../database/core/view-creation';
import type { CardMoved, ViewChange } from '../../database/core/view-state';
import { boardLayout } from '../../database/core/views';
import type { DatabaseOpFailure } from '../../database/core/write-failure';
import type { Pipeline } from '../core/pipeline';
import type { CrmRecordDependencies } from './dependencies';
import { crmKeys } from './keys';

type ViewOpResult = Extract<OpResult, { kind: 'view' }>;

/** The pipeline's single table, whose stored views the toolbar lists. */
export function usePipelineTableQuery(
  deps: CrmRecordDependencies,
  pipeline: Pipeline
) {
  return useQuery(
    () => ({
      queryKey: crmKeys.pipelineTable(pipeline.id).queryKey,
      queryFn: () =>
        throwOnErr(() => deps.storage.getCrmPipelineTable(pipeline.id)),
    }),
    () => deps.client
  );
}

/**
 * Stored views of a pipeline's table, written as database view ops through the
 * pipeline's own endpoint. Its storage database is not the viewer's to address.
 */
export function createPipelineViews(
  deps: CrmRecordDependencies,
  pipeline: Pipeline
) {
  const key = crmKeys.pipelineTable(pipeline.id).queryKey;
  // Each view's writes, and the view list's, reach the server in order.
  const writes = createKeyedSerializer();
  const inOrder = <Value>(
    order: string,
    write: () => ResultAsync<Value, DatabaseOpFailure>
  ) => new ResultAsync(writes.run(order, async () => await write()));
  const patchViews = (change: (views: DatabaseView[]) => DatabaseView[]) =>
    deps.client.setQueryData<TableDetail>(
      key,
      (detail) => detail && { ...detail, views: change(detail.views) }
    );
  const upsert = (view: DatabaseView) =>
    patchViews((views) =>
      views.some((existing) => existing.id === view.id)
        ? views.map((existing) => (existing.id === view.id ? view : existing))
        : [...views, view]
    );
  const apply = (ops: DatabaseOp[]) =>
    deps.storage
      .applyCrmPipelineOps(pipeline.id, { ops })
      .map((response) => response.results)
      .mapErr(([error]): DatabaseOpFailure => ({ kind: 'ops', error }))
      .orElse((failure) => {
        // A refusal shows what is stored instead of what was patched in.
        void deps.client.invalidateQueries({ queryKey: key });
        return errAsync(failure);
      });
  const lastView = (results: OpResult[]) => {
    const result = results.at(-1) as ViewOpResult | undefined;
    return result?.kind === 'view' && 'view' in result.change
      ? okAsync(result.change.view)
      : errAsync<DatabaseView, DatabaseOpFailure>({
          kind: 'unexpected-result',
        });
  };
  const listKey = `table:${pipeline.tableId}`;
  const status = () => ({
    column: uuidv7(),
    options: [uuidv7(), uuidv7(), uuidv7()] as [string, string, string],
  });

  return {
    /** Add a view that starts from `current`; a board without a grouping column adds a Status column. */
    create(
      current: DatabaseView,
      input: NewView,
      columns: readonly DatabaseViewColumn[]
    ) {
      const viewId = uuidv7();
      const created = (layout: DatabaseView['layout']): DatabaseOp[] => [
        {
          kind: 'view',
          table: pipeline.tableId,
          view: viewId,
          change: {
            kind: 'create',
            view: { name: input.name, query: current.query, layout },
          },
        },
      ];
      let ops: DatabaseOp[];
      if (input.layout === 'table')
        ops = created(
          current.layout.kind === 'table'
            ? current.layout
            : { kind: 'table', columns: [] }
        );
      else if (input.groupBy.kind === 'column')
        ops = created(boardLayout(input.groupBy.columnId, columns));
      else
        ops = newBoardWithStatusColumn({
          tableId: pipeline.tableId,
          viewId,
          name: input.name,
          query: current.query,
          columns,
          status: status(),
        });
      return inOrder(listKey, () => apply(ops).andThen(lastView)).map(
        (view) => {
          upsert(view);
          return view;
        }
      );
    },
    update(view: DatabaseView, change: ViewChange) {
      patchViews((views) =>
        views.map((existing) =>
          existing.id === view.id ? { ...existing, ...change } : existing
        )
      );
      return inOrder(view.id, () =>
        apply([
          {
            kind: 'view',
            table: view.tableId,
            view: view.id,
            change: { kind: 'update', ...change },
          },
        ]).andThen(lastView)
      ).map(upsert);
    },
    /** Lay a view out as a board grouped by a new Status column, in one batch. */
    showAsBoardWithStatusColumn(
      view: DatabaseView,
      columns: readonly DatabaseViewColumn[]
    ) {
      return inOrder(view.id, () =>
        apply(boardWithStatusColumn({ view, columns, status: status() }))
          .andThen(lastView)
          .map((stored) => {
            upsert(stored);
            // The new column arrives with the table read.
            void deps.client.invalidateQueries({ queryKey: key });
          })
      );
    },
    remove(view: DatabaseView) {
      patchViews((views) =>
        views.filter((existing) => existing.id !== view.id)
      );
      return inOrder(view.id, () =>
        apply([
          {
            kind: 'view',
            table: view.tableId,
            view: view.id,
            change: { kind: 'delete' },
          },
        ])
      ).map(() => undefined);
    },
    /** Move a stored board's card, which also sets its row's grouping cell. */
    moveCard(
      view: DatabaseView,
      move: CardMove
    ): ResultAsync<CardMoved, DatabaseOpFailure> {
      return inOrder(view.id, () =>
        apply([
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
        ])
      ).andThen((results) => {
        const result = results.at(-1) as ViewOpResult | undefined;
        return result?.kind === 'view' &&
          result.change.kind === 'card_moved' &&
          result.tableVersion != null
          ? okAsync({
              positions: result.change.positions,
              tableVersion: result.tableVersion,
            })
          : errAsync<CardMoved, DatabaseOpFailure>({
              kind: 'unexpected-result',
            });
      });
    },
  };
}

export type PipelineViews = ReturnType<typeof createPipelineViews>;
