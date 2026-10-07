import type { DatabaseOpsError } from '@service-storage/databases';
import type { CardPosition } from '@service-storage/generated/schemas/cardPosition';
import type { ViewLayout } from '@service-storage/generated/schemas/viewLayout';
import { Button } from '@ui/components/Button';
import { ConfirmDialog } from '@ui/components/ConfirmDialog';
import { Result, type ResultAsync } from 'neverthrow';
import {
  type Accessor,
  createMemo,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { toast } from '../../../lib/core/component/Toast/Toast';
import { engineFailure } from '../../../lib/core/database-sql/driver';
import type { LaneKey } from '../../../lib/core/database-sql/generated/types';
import { BoardMenu } from '../components/board-menu';
import {
  DatabaseBoard,
  type DatabaseBoardControls,
} from '../components/database-board';
import {
  BoardSkeleton,
  DatabaseLoadFailure,
} from '../components/database-load-state';
import type { DatabaseTableProps } from '../components/database-table';
import type { DatabaseRowsSource } from '../context/table-source';
import {
  type CardMove,
  cardMove,
  cardsOf,
  laneCards,
  placeCard,
  withMovedCards,
  withPositions,
} from '../core/board-moves';
import type { DatabaseEntityType } from '../core/column-inference';
import {
  type DatabaseViewColumn,
  isBoardGroupColumn,
  isOptionColumn,
} from '../core/database-view';
import type { DatabaseRow } from '../core/table';
import type {
  CardMoved,
  DatabaseViewState,
  ViewChange,
} from '../core/view-state';
import { laneValue, withLaneHidden, withLaneOrder } from '../core/views';
import {
  type DatabaseOpFailure,
  databaseOpMessage,
} from '../core/write-failure';
import {
  type BoardPositionsState,
  boardViewState,
  createBoardEngine,
} from '../primitives/board-layout';
import type { RecordCreation } from '../primitives/record-actions';

type BoardLayout = Extract<ViewLayout, { kind: 'board' }>;

/** Where a board's card places come from, and how a move is written. */
export type BoardPositions = {
  state: Accessor<BoardPositionsState>;
  setPositions?: (
    change: (positions: CardPosition[]) => CardPosition[]
  ) => void;
  move?: (move: CardMove) => ResultAsync<CardMoved, DatabaseOpFailure>;
};

type DatabaseBoardViewProps = {
  view: DatabaseViewState;
  source: DatabaseRowsSource;
  rows: DatabaseRow[];
  columns: DatabaseViewColumn[];
  positions: BoardPositions;
  canEdit: boolean;
  onViewChange?: (change: ViewChange) => void;
  rowPending: (rowId: string) => boolean;
  createPending: (intentId: string) => boolean;
  createComplete: (intentId: string) => boolean;
  onOpen: (rowId: string) => void;
  onCreate: (creation: RecordCreation) => Promise<boolean>;
  /** Adds an option to the group column; absent for viewers. */
  onAddGroup?: (
    columnId: string,
    label: string
  ) => Promise<Result<void, DatabaseOpsError>>;
  renderCell?: DatabaseTableProps['renderCell'];
  renderTextValue?: (value: string) => JSX.Element;
  renderMentionValue?: (id: string, type: DatabaseEntityType) => JSX.Element;
  controlsRef?: (controls: DatabaseBoardControls) => void;
};

/** A board view grouped by its single select or single person, or a way back to the table when it has neither. */
export function DatabaseBoardView(props: DatabaseBoardViewProps) {
  const grouping = () => {
    const layout = props.view.layout;
    if (layout.kind !== 'board') return undefined;
    const group = props.columns.find(
      (column) => column.id === layout.groupBy && isBoardGroupColumn(column)
    );
    return group ? { layout, group } : undefined;
  };
  const menu = () => {
    const layout = props.view.layout;
    const changeView = props.onViewChange;
    return layout.kind === 'board' && changeView
      ? { layout, changeView }
      : undefined;
  };
  return (
    <>
      <Show when={menu()}>
        {(shown) => (
          <div class="flex shrink-0 items-center justify-end px-5 pt-2">
            <BoardMenu
              layout={shown().layout}
              columns={props.columns}
              onChange={(layout) => shown().changeView({ layout })}
            />
          </div>
        )}
      </Show>
      <Show
        when={grouping()}
        fallback={
          <div class="flex flex-1 flex-col items-start px-5 py-8">
            <p class="text-sm text-ink-muted">
              Choose a single Select or Person column to group cards.
            </p>
            <Show when={props.onViewChange}>
              {(changeView) => (
                <Button
                  size="sm"
                  class="mt-3"
                  onClick={() =>
                    changeView()({ layout: { kind: 'table', columns: [] } })
                  }
                >
                  Open table
                </Button>
              )}
            </Show>
          </div>
        }
      >
        {(shown) => (
          <GroupedBoard
            {...props}
            layout={shown().layout}
            groupColumn={shown().group}
          />
        )}
      </Show>
    </>
  );
}

/**
 * A board laid out by the engine from the view's rows and card places. A move
 * shows at once and settles on the server's places; on a sorted board a drag
 * first asks to remove the sort.
 */
function GroupedBoard(
  props: DatabaseBoardViewProps & {
    layout: BoardLayout;
    groupColumn: DatabaseViewColumn;
  }
) {
  const engine = createBoardEngine();
  const state = createMemo(() =>
    boardViewState(engine, props.positions.state())
  );
  const failure = () => {
    const current = state();
    return current.kind === 'failed' ? current : undefined;
  };
  const canEdit = () => props.canEdit && props.groupColumn.writable;
  /** Moves shown ahead of the rows: until a read reaches the table version the server's move left. */
  const [moves, setMoves] = createSignal<
    { move: CardMove; tableVersion?: number }[]
  >([]);
  /** A drop on a sorted board, held until the sort goes: where in its lane it landed. */
  const [sortedDrop, setSortedDrop] = createSignal<{
    row: string;
    lane: LaneKey;
    index: number;
  }>();
  /** The board as the engine lays it out, sorted as the view says or, with `unsorted`, by hand. */
  const layOut = (unsorted: boolean) => {
    const ready = state();
    const read = props.source.read?.();
    if (ready.kind !== 'ready' || !read) return undefined;
    const query = unsorted ? { ...read.view.query, sort: [] } : read.view.query;
    return Result.fromThrowable(ready.engine.board, engineFailure)(
      read.catalog,
      { ...read.view, query, layout: props.layout },
      read.outcome,
      ready.positions
    );
  };
  const laidOut = createMemo(() => layOut(false));
  const board = () => {
    const result = laidOut();
    if (!result?.isOk()) return undefined;
    const readVersion = props.source.snapshot()?.version;
    const pending = moves().flatMap((entry) =>
      entry.tableVersion !== undefined &&
      readVersion !== undefined &&
      readVersion >= entry.tableVersion
        ? []
        : [entry.move]
    );
    return withMovedCards(result.value, pending);
  };
  function forget(move: CardMove) {
    setMoves((current) => current.filter((entry) => entry.move !== move));
  }
  function taken(move: CardMove, tableVersion: number) {
    setMoves((current) =>
      current.map((entry) =>
        entry.move === move ? { ...entry, tableVersion } : entry
      )
    );
  }
  function write(move: CardMove) {
    const persist = props.positions.move;
    if (!persist) return;
    const ready = state();
    const shown = board();
    // A move the shown lane has no place for writes no early places; the server's answer settles them.
    const placed =
      ready.kind === 'ready' && shown
        ? placeCard(
            laneCards(shown, ready.positions, move.lane, move.row),
            move,
            ready.engine.keyBetween
          )
        : undefined;
    if (placed?.isOk())
      props.positions.setPositions?.((current) =>
        withPositions(current, placed.value)
      );
    setMoves((current) => [...current, { move }]);
    void persist(move)
      .map(({ positions, tableVersion }) => {
        props.positions.setPositions?.((current) =>
          withPositions(current, positions)
        );
        taken(move, tableVersion);
      })
      .mapErr((failure) => {
        forget(move);
        toast.failure(databaseOpMessage(failure, 'this card'));
      });
  }
  function drop(row: string, lane: LaneKey, next?: string) {
    const shown = board();
    const move = shown && cardMove(shown, row, lane, next);
    if (!move) return;
    if (!props.view.query.sort?.length) {
      write(move);
      return;
    }
    const others = cardsOf(shown, lane).filter((card) => card !== row);
    const index = next === undefined ? others.length : others.indexOf(next);
    if (index < 0) return;
    setSortedDrop({ row, lane, index });
  }
  /** Without the sort the lane shows its arranged order; the card lands at the index it was dropped at. */
  function removeSortAndMove() {
    const dropped = sortedDrop();
    setSortedDrop(undefined);
    if (!dropped) return;
    props.onViewChange?.({ query: { ...props.view.query, sort: [] } });
    const laid = layOut(true);
    if (!laid?.isOk()) return;
    const arranged = laid.value;
    const others = cardsOf(arranged, dropped.lane).filter(
      (card) => card !== dropped.row
    );
    const move = cardMove(
      arranged,
      dropped.row,
      dropped.lane,
      others[dropped.index]
    );
    if (move) write(move);
  }
  function create(
    lane: LaneKey,
    title: string,
    intentId: string,
    options?: { open: true }
  ) {
    const value = laneValue(props.groupColumn, lane);
    return props.onCreate({
      values: value === undefined ? {} : { [props.groupColumn.id]: value },
      title,
      titleColumn: props.layout.title,
      intentId,
      open: options?.open ?? false,
    });
  }
  const changeLayout = (layout: BoardLayout) =>
    props.onViewChange?.({ layout });
  const addGroup = () => {
    const add = props.onAddGroup;
    const columnId = props.groupColumn.id;
    return add && canEdit() && isOptionColumn(props.groupColumn)
      ? (label: string) => add(columnId, label)
      : undefined;
  };
  return (
    <>
      <Switch fallback={<BoardSkeleton />}>
        <Match when={failure()}>
          {(failed) => (
            <DatabaseLoadFailure
              title={failed().title}
              message={failed().message}
              onRetry={failed().retry}
            />
          )}
        </Match>
        <Match when={board()}>
          {(shown) => (
            <DatabaseBoard
              rows={props.rows}
              columns={props.columns}
              board={shown()}
              layout={props.layout}
              groupColumn={props.groupColumn}
              renderCell={props.renderCell}
              renderTextValue={props.renderTextValue}
              renderMentionValue={props.renderMentionValue}
              canEdit={props.canEdit}
              rowPending={props.rowPending}
              createPending={props.createPending}
              createComplete={props.createComplete}
              onOpen={props.onOpen}
              onMove={props.positions.move ? drop : undefined}
              onLaneOrderChange={
                props.onViewChange
                  ? (order) => changeLayout(withLaneOrder(props.layout, order))
                  : undefined
              }
              onHideLane={
                props.onViewChange
                  ? (lane) =>
                      changeLayout(withLaneHidden(props.layout, lane, true))
                  : undefined
              }
              onHideEmptyLanes={
                props.onViewChange
                  ? (hideEmptyLanes) =>
                      changeLayout({ ...props.layout, hideEmptyLanes })
                  : undefined
              }
              onCreate={create}
              onAddGroup={addGroup()}
              controlsRef={props.controlsRef}
            />
          )}
        </Match>
        <Match when={laidOut()?.isErr()}>
          <DatabaseLoadFailure
            title="This board could not be laid out"
            message="Refresh the table, then try again."
            onRetry={() => void props.source.refresh()}
          />
        </Match>
      </Switch>
      <ConfirmDialog
        open={!!sortedDrop()}
        onOpenChange={(open) => {
          if (!open) setSortedDrop(undefined);
        }}
        title="Remove sort to arrange cards manually?"
        confirmLabel="Remove sort"
        onConfirm={removeSortAndMove}
        body={
          <p>
            This board is sorted, so its cards keep the sort’s order. Without
            the sort, cards show in the order you arrange them, starting with
            this one where you dropped it.
          </p>
        }
      />
    </>
  );
}
